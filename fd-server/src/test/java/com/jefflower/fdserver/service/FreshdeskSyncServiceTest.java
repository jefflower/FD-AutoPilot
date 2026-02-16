package com.jefflower.fdserver.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ticket.client.FreshdeskApiClient;
import com.jefflower.fdserver.ticket.dto.TicketContent;
import com.jefflower.fdserver.ticket.entity.SyncLog;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.enums.TicketStatus;
import com.jefflower.fdserver.ticket.enums.TriggerType;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import com.jefflower.fdserver.ticket.service.FreshdeskSyncService;
import com.jefflower.fdserver.ticket.service.MqPublisherService;
import com.jefflower.fdserver.ticket.service.SyncConfigService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FreshdeskSyncServiceTest {

    @Mock
    private FreshdeskApiClient apiClient;

    @Mock
    private TicketRepository ticketRepository;

    @Mock
    private MqPublisherService mqPublisherService;

    @Mock
    private SyncConfigService syncConfigService;

    @Mock
    private com.jefflower.fdserver.task.service.TaskDistributionService taskDistributionService;

    @InjectMocks
    private FreshdeskSyncService freshdeskSyncService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        // InjectMocks won't inject the real ObjectMapper, so we set it manually
        ReflectionTestUtils.setField(freshdeskSyncService, "objectMapper", objectMapper);
        ReflectionTestUtils.setField(freshdeskSyncService, "syncStatuses", "2,3");
    }

    // ========== Helper methods ==========

    private Map<String, Object> buildFdTicket(String id, String subject, String description) {
        Map<String, Object> ticket = new HashMap<>();
        ticket.put("id", Integer.parseInt(id));
        ticket.put("subject", subject);
        ticket.put("description_text", description);
        ticket.put("status", 2);
        ticket.put("priority", 1);
        ticket.put("source", 1);
        ticket.put("type", "Question");
        ticket.put("requester_id", 100L);
        ticket.put("responder_id", 200L);
        ticket.put("group_id", 300L);
        ticket.put("tags", List.of("urgent", "vip"));
        ticket.put("created_at", "2024-12-01T10:30:00Z");
        ticket.put("updated_at", "2024-12-02T11:00:00Z");
        return ticket;
    }

    private Ticket buildExistingTicket(String externalId, TicketStatus status, String contentHash) {
        Ticket ticket = new Ticket();
        ticket.setId(1L);
        ticket.setExternalId(externalId);
        ticket.setStatus(status);
        ticket.setContentHash(contentHash);
        ticket.setSubject("Old subject");
        ticket.setContent("old content");
        return ticket;
    }

    // ========== syncTicketsWithLock ==========

    @Test
    void syncTicketsWithLock_lockUnavailable_returnsFailure() {
        when(syncConfigService.tryAcquireSyncLock()).thenReturn(false);

        FreshdeskSyncService.SyncResult result =
                freshdeskSyncService.syncTicketsWithLock(TriggerType.MANUAL);

        assertFalse(result.isSuccess());
        assertTrue(result.getMessage().contains("同步正在进行中"));
        verify(syncConfigService, never()).createSyncLog(any());
    }

    @Test
    void syncTicketsWithLock_noTickets_returnsZero() {
        when(syncConfigService.tryAcquireSyncLock()).thenReturn(true);
        when(syncConfigService.createSyncLog(TriggerType.MANUAL)).thenReturn(new SyncLog());
        when(syncConfigService.getLastSyncTime()).thenReturn(null);
        when(apiClient.fetchAllTickets(isNull(), anySet())).thenReturn(Collections.emptyList());

        FreshdeskSyncService.SyncResult result =
                freshdeskSyncService.syncTicketsWithLock(TriggerType.MANUAL);

        assertTrue(result.isSuccess());
        assertEquals(0, result.getSyncedCount());
        assertEquals(0, result.getUpdatedCount());
        assertEquals(0, result.getSkippedCount());
        verify(syncConfigService).releaseSyncLock();
    }

    @Test
    void syncTicketsWithLock_withNewTickets_syncsSuccessfully() {
        when(syncConfigService.tryAcquireSyncLock()).thenReturn(true);
        when(syncConfigService.createSyncLog(TriggerType.SCHEDULED)).thenReturn(new SyncLog());
        when(syncConfigService.getLastSyncTime()).thenReturn(null);

        Map<String, Object> fdTicket = buildFdTicket("12345", "Test ticket", "Hello world");
        when(apiClient.fetchAllTickets(isNull(), anySet())).thenReturn(List.of(fdTicket));
        when(ticketRepository.findByExternalId("12345")).thenReturn(Optional.empty());
        when(apiClient.fetchAllConversations("12345")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(invocation -> {
            Ticket t = invocation.getArgument(0);
            t.setId(1L);
            return t;
        });

        FreshdeskSyncService.SyncResult result =
                freshdeskSyncService.syncTicketsWithLock(TriggerType.SCHEDULED);

        assertTrue(result.isSuccess());
        assertEquals(1, result.getSyncedCount());
        verify(mqPublisherService).sendTranslationTask(any(Ticket.class));
        verify(syncConfigService).releaseSyncLock();
    }

    @Test
    void syncTicketsWithLock_exceptionReleasesLock() {
        when(syncConfigService.tryAcquireSyncLock()).thenReturn(true);
        when(syncConfigService.createSyncLog(any())).thenThrow(new RuntimeException("DB error"));

        FreshdeskSyncService.SyncResult result =
                freshdeskSyncService.syncTicketsWithLock(TriggerType.MANUAL);

        assertFalse(result.isSuccess());
        assertTrue(result.getMessage().contains("同步失败"));
        verify(syncConfigService).releaseSyncLock();
    }

    // ========== processSingleTicket ==========

    @Test
    void processSingleTicket_newTicket_createsAndSendsToMQ() {
        Map<String, Object> fdTicket = buildFdTicket("99999", "New ticket", "Content here");

        when(ticketRepository.findByExternalId("99999")).thenReturn(Optional.empty());
        when(apiClient.fetchAllConversations("99999")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(invocation -> {
            Ticket t = invocation.getArgument(0);
            t.setId(5L);
            return t;
        });

        FreshdeskSyncService.TicketSyncResult result =
                freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        assertEquals(FreshdeskSyncService.TicketSyncResult.NEW, result);

        ArgumentCaptor<Ticket> captor = ArgumentCaptor.forClass(Ticket.class);
        verify(ticketRepository).save(captor.capture());
        Ticket saved = captor.getValue();
        assertEquals("99999", saved.getExternalId());
        assertEquals("New ticket", saved.getSubject());
        assertEquals(TicketStatus.PENDING_TRANS, saved.getStatus());
        assertEquals("POLLING", saved.getSyncSource());
        assertNotNull(saved.getContentHash());

        // Freshdesk metadata
        assertEquals(2, saved.getFdStatus());
        assertEquals(1, saved.getFdPriority());
        assertEquals("urgent,vip", saved.getFdTags());

        verify(mqPublisherService).sendTranslationTask(any(Ticket.class));
    }

    @Test
    void processSingleTicket_existingUnchangedContent_skips() {
        Map<String, Object> fdTicket = buildFdTicket("100", "Subject", "Same content");

        // Build expected content hash using the same TicketContent model as the service
        TicketContent contentModel = new TicketContent();
        contentModel.setDescription("Same content");
        contentModel.setConversations(null);
        String contentJson;
        try {
            contentJson = objectMapper.writeValueAsString(contentModel);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        String expectedHash = computeHash(contentJson);

        Ticket existing = buildExistingTicket("100", TicketStatus.PENDING_REPLY, expectedHash);
        when(ticketRepository.findByExternalId("100")).thenReturn(Optional.of(existing));
        when(apiClient.fetchAllConversations("100")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(i -> i.getArgument(0));

        FreshdeskSyncService.TicketSyncResult result =
                freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        assertEquals(FreshdeskSyncService.TicketSyncResult.SKIPPED, result);
        verify(mqPublisherService, never()).sendTranslationTask(any());
    }

    @Test
    void processSingleTicket_existingChangedContent_completedStatus_triggersWorkflow() {
        Map<String, Object> fdTicket = buildFdTicket("200", "Updated subject", "New content");

        Ticket existing = buildExistingTicket("200", TicketStatus.COMPLETED, "old-hash");
        when(ticketRepository.findByExternalId("200")).thenReturn(Optional.of(existing));
        when(apiClient.fetchAllConversations("200")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(i -> i.getArgument(0));

        FreshdeskSyncService.TicketSyncResult result =
                freshdeskSyncService.processSingleTicket(fdTicket, "WEBHOOK");

        assertEquals(FreshdeskSyncService.TicketSyncResult.UPDATED, result);
        verify(mqPublisherService).sendTranslationTask(any(Ticket.class));
    }

    @Test
    void processSingleTicket_existingChangedContent_approvedStatus_noWorkflowTrigger() {
        Map<String, Object> fdTicket = buildFdTicket("300", "Subject", "Changed content");

        Ticket existing = buildExistingTicket("300", TicketStatus.APPROVED, "old-hash");
        when(ticketRepository.findByExternalId("300")).thenReturn(Optional.of(existing));
        when(apiClient.fetchAllConversations("300")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(i -> i.getArgument(0));

        FreshdeskSyncService.TicketSyncResult result =
                freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        assertEquals(FreshdeskSyncService.TicketSyncResult.UPDATED, result);
        // APPROVED is not in the doNotDisturb set, but shouldTriggerWorkflow returns
        // true only for COMPLETED. APPROVED is neither in doNotDisturb nor COMPLETED,
        // so workflow should NOT be triggered.
        verify(mqPublisherService, never()).sendTranslationTask(any());
    }

    @ParameterizedTest
    @EnumSource(value = TicketStatus.class, names = {
            "PENDING_TRANS", "TRANSLATING", "PENDING_REPLY", "REPLYING", "PENDING_AUDIT", "AUDITING"
    })
    void processSingleTicket_activeStatuses_doNotTriggerWorkflow(TicketStatus activeStatus) {
        Map<String, Object> fdTicket = buildFdTicket("400", "Subject", "Changed content");

        Ticket existing = buildExistingTicket("400", activeStatus, "old-hash");
        when(ticketRepository.findByExternalId("400")).thenReturn(Optional.of(existing));
        when(apiClient.fetchAllConversations("400")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(i -> i.getArgument(0));

        FreshdeskSyncService.TicketSyncResult result =
                freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        assertEquals(FreshdeskSyncService.TicketSyncResult.UPDATED, result);
        verify(mqPublisherService, never()).sendTranslationTask(any());
    }

    @Test
    void processSingleTicket_withConversations_buildsFullContent() {
        Map<String, Object> fdTicket = buildFdTicket("500", "Subject", "Description here");

        Map<String, Object> conv = new HashMap<>();
        conv.put("id", 1001);
        conv.put("body_text", "Customer reply");
        conv.put("private", false);
        conv.put("incoming", true);
        conv.put("user_id", 555L);
        conv.put("created_at", "2024-12-03T09:00:00Z");

        when(ticketRepository.findByExternalId("500")).thenReturn(Optional.empty());
        when(apiClient.fetchAllConversations("500")).thenReturn(List.of(conv));
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(invocation -> {
            Ticket t = invocation.getArgument(0);
            t.setId(10L);
            return t;
        });

        FreshdeskSyncService.TicketSyncResult result =
                freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        assertEquals(FreshdeskSyncService.TicketSyncResult.NEW, result);

        ArgumentCaptor<Ticket> captor = ArgumentCaptor.forClass(Ticket.class);
        verify(ticketRepository).save(captor.capture());
        String content = captor.getValue().getContent();
        assertTrue(content.contains("Description here"));
        assertTrue(content.contains("Customer reply"));
    }

    @Test
    void processSingleTicket_descriptionFallback_usesDescriptionField() {
        Map<String, Object> fdTicket = buildFdTicket("600", "Subject", null);
        fdTicket.remove("description_text");
        fdTicket.put("description", "<p>HTML description</p>");

        when(ticketRepository.findByExternalId("600")).thenReturn(Optional.empty());
        when(apiClient.fetchAllConversations("600")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(invocation -> {
            Ticket t = invocation.getArgument(0);
            t.setId(11L);
            return t;
        });

        freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        ArgumentCaptor<Ticket> captor = ArgumentCaptor.forClass(Ticket.class);
        verify(ticketRepository).save(captor.capture());
        assertTrue(captor.getValue().getContent().contains("HTML description"));
    }

    // ========== processSingleTicketFromWebhook ==========

    @Test
    void processSingleTicketFromWebhook_newTicket_logsCorrectly() {
        Map<String, Object> fdTicket = buildFdTicket("700", "Webhook ticket", "Webhook content");
        SyncLog syncLog = new SyncLog();

        when(syncConfigService.createSyncLog(TriggerType.WEBHOOK)).thenReturn(syncLog);
        when(ticketRepository.findByExternalId("700")).thenReturn(Optional.empty());
        when(apiClient.fetchAllConversations("700")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(invocation -> {
            Ticket t = invocation.getArgument(0);
            t.setId(20L);
            return t;
        });

        freshdeskSyncService.processSingleTicketFromWebhook(fdTicket);

        verify(syncConfigService).completeSyncLog(syncLog, 1, 0);
    }

    @Test
    void processSingleTicketFromWebhook_exception_failsLog() {
        Map<String, Object> fdTicket = buildFdTicket("800", "Subject", "Content");
        SyncLog syncLog = new SyncLog();

        when(syncConfigService.createSyncLog(TriggerType.WEBHOOK)).thenReturn(syncLog);
        when(ticketRepository.findByExternalId("800")).thenThrow(new RuntimeException("DB error"));

        assertThrows(RuntimeException.class,
                () -> freshdeskSyncService.processSingleTicketFromWebhook(fdTicket));

        verify(syncConfigService).failSyncLog(eq(syncLog), contains("DB error"));
    }

    // ========== syncTickets (legacy) ==========

    @Test
    void syncTickets_success_returnsSyncedCount() {
        when(syncConfigService.tryAcquireSyncLock()).thenReturn(true);
        when(syncConfigService.createSyncLog(TriggerType.MANUAL)).thenReturn(new SyncLog());
        when(syncConfigService.getLastSyncTime()).thenReturn(null);
        when(apiClient.fetchAllTickets(isNull(), anySet())).thenReturn(Collections.emptyList());

        int result = freshdeskSyncService.syncTickets();

        assertEquals(0, result);
    }

    @Test
    void syncTickets_lockFailed_throwsException() {
        when(syncConfigService.tryAcquireSyncLock()).thenReturn(false);

        assertThrows(RuntimeException.class, () -> freshdeskSyncService.syncTickets());
    }

    // ========== Freshdesk metadata population ==========

    @Test
    void processSingleTicket_populatesFreshdeskMetadata() {
        Map<String, Object> fdTicket = buildFdTicket("900", "Metadata test", "Content");

        when(ticketRepository.findByExternalId("900")).thenReturn(Optional.empty());
        when(apiClient.fetchAllConversations("900")).thenReturn(Collections.emptyList());
        when(ticketRepository.save(any(Ticket.class))).thenAnswer(invocation -> {
            Ticket t = invocation.getArgument(0);
            t.setId(30L);
            return t;
        });

        freshdeskSyncService.processSingleTicket(fdTicket, "POLLING");

        ArgumentCaptor<Ticket> captor = ArgumentCaptor.forClass(Ticket.class);
        verify(ticketRepository).save(captor.capture());
        Ticket saved = captor.getValue();

        assertEquals(2, saved.getFdStatus());
        assertEquals(1, saved.getFdPriority());
        assertEquals(1, saved.getFdSource());
        assertEquals("Question", saved.getFdType());
        assertEquals(100L, saved.getFdRequesterId());
        assertEquals(200L, saved.getFdResponderId());
        assertEquals(300L, saved.getFdGroupId());
        assertEquals("urgent,vip", saved.getFdTags());
        assertNotNull(saved.getFdCreatedAt());
        assertNotNull(saved.getFdUpdatedAt());
    }

    // ========== Utilities ==========

    private String serializeContent(String description, List<Object> conversations) {
        try {
            Map<String, Object> content = new HashMap<>();
            content.put("description", description);
            content.put("conversations", conversations);
            return objectMapper.writeValueAsString(content);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String computeHash(String content) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
