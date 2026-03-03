package com.jefflower.fdserver.ai.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jefflower.fdserver.ai.dto.ClientHeartbeatRequest;
import com.jefflower.fdserver.ai.dto.ClientHeartbeatResponse;
import com.jefflower.fdserver.ai.dto.ClientRegisterRequest;
import com.jefflower.fdserver.ai.dto.ClientRegisterResponse;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.ClientRegistration;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.ai.repository.ClientRegistrationRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("ClientRegistrationService 单元测试")
class ClientRegistrationServiceTest {

    @Mock
    private ClientRegistrationRepository clientRepo;

    @Mock
    private AgentInstanceRepository instanceRepo;

    @Mock
    private AgentDefinitionRepository definitionRepo;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private ClientRegistrationService service;

    // --- 测试数据 ---
    private AgentDefinition geminiAgent;
    private AgentDefinition notebooklmAgent;
    private AgentDefinition noCapAgent; // requiredCapability = null
    private ClientRegisterRequest registerRequest;

    @BeforeEach
    void setUp() throws Exception {
        geminiAgent = new AgentDefinition();
        geminiAgent.setId(1L);
        geminiAgent.setCode("gemini-translate");
        geminiAgent.setCapability("translation");
        geminiAgent.setRequiredCapability("gemini-cli");
        geminiAgent.setProviderType(ProviderType.GEMINI_CLI);
        geminiAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        geminiAgent.setEnabled(true);
        geminiAgent.setSortOrder(1);

        notebooklmAgent = new AgentDefinition();
        notebooklmAgent.setId(2L);
        notebooklmAgent.setCode("notebooklm-reply");
        notebooklmAgent.setCapability("reply");
        notebooklmAgent.setRequiredCapability("notebooklm");
        notebooklmAgent.setProviderType(ProviderType.NOTEBOOKLM);
        notebooklmAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        notebooklmAgent.setEnabled(true);
        notebooklmAgent.setSortOrder(2);

        noCapAgent = new AgentDefinition();
        noCapAgent.setId(3L);
        noCapAgent.setCode("server-agent");
        noCapAgent.setCapability("query");
        noCapAgent.setRequiredCapability(null); // 无需客户端 capability
        noCapAgent.setProviderType(ProviderType.HTTP_API);
        noCapAgent.setExecutionEnv(ExecutionEnv.SERVER_ONLY);
        noCapAgent.setEnabled(true);
        noCapAgent.setSortOrder(3);

        registerRequest = new ClientRegisterRequest();
        registerRequest.setClientId("client-001");
        registerRequest.setClientType("TAURI");
        registerRequest.setVersion("1.0.0");
        registerRequest.setEnabledCapabilities(List.of("gemini-cli"));
        registerRequest.setRunningAgents(List.of("gemini-translate"));

        // ObjectMapper stub 使用 lenient 模式，因为 heartbeat/isClientOnline 测试不调用 writeValueAsString
        lenient().when(objectMapper.writeValueAsString(any())).thenReturn("[\"gemini-cli\"]");
    }

    @Nested
    @DisplayName("register 首次注册场景")
    class FirstTimeRegisterTests {

        @Test
        @DisplayName("shouldCreateNewClientRegistrationWhenClientNotExists - 新客户端首次注册")
        void shouldCreateNewClientRegistrationWhenClientNotExists() {
            when(clientRepo.findById("client-001")).thenReturn(Optional.empty());
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent, notebooklmAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(Collections.emptyList());
            when(clientRepo.findByOnlineTrue()).thenReturn(List.of(new ClientRegistration()));

            ClientRegisterResponse response = service.register("user-001", registerRequest);

            assertNotNull(response);
            assertEquals("client-001", response.getClientId());

            // 验证 ClientRegistration 被创建并保存
            ArgumentCaptor<ClientRegistration> regCaptor = ArgumentCaptor.forClass(ClientRegistration.class);
            verify(clientRepo).save(regCaptor.capture());
            ClientRegistration savedReg = regCaptor.getValue();
            assertEquals("client-001", savedReg.getClientId());
            assertEquals("user-001", savedReg.getUserId());
            assertEquals("TAURI", savedReg.getClientType());
            assertEquals("1.0.0", savedReg.getVersion());
            assertTrue(savedReg.isOnline());
            assertNotNull(savedReg.getLastHeartbeat());
        }

        @Test
        @DisplayName("shouldCreateAgentInstanceForMatchingCapabilityOnFirstRegister - 首次注册自动创建 AgentInstance")
        void shouldCreateAgentInstanceForMatchingCapabilityOnFirstRegister() {
            // 客户端只上报 gemini-cli，所以只有 geminiAgent 匹配
            when(clientRepo.findById("client-001")).thenReturn(Optional.empty());
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent, notebooklmAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> {
                AgentInstance inst = inv.getArgument(0);
                inst.setId(100L);
                return inst;
            });
            when(instanceRepo.findByClientId("client-001")).thenReturn(Collections.emptyList());
            when(clientRepo.findByOnlineTrue()).thenReturn(Collections.emptyList());

            service.register("user-001", registerRequest);

            // 只应为 geminiAgent 创建 AgentInstance（notebooklmAgent 不匹配）
            ArgumentCaptor<AgentInstance> instCaptor = ArgumentCaptor.forClass(AgentInstance.class);
            verify(instanceRepo, atLeastOnce()).save(instCaptor.capture());
            List<AgentInstance> savedInstances = instCaptor.getAllValues();

            // 过滤出新创建的（非 running=false 更新的）
            boolean hasGeminiInstance = savedInstances.stream()
                    .anyMatch(i -> "gemini-translate".equals(i.getAgentCode())
                            && "client-001".equals(i.getClientId())
                            && "user-001".equals(i.getUserId()));
            assertTrue(hasGeminiInstance, "应该为 gemini-translate 创建 AgentInstance");
        }
    }

    @Nested
    @DisplayName("register 重复注册场景")
    class DuplicateRegisterTests {

        @Test
        @DisplayName("shouldUpdateExistingClientRegistrationWhenClientAlreadyRegistered - 同 clientId 重复注册时更新信息")
        void shouldUpdateExistingClientRegistrationWhenClientAlreadyRegistered() {
            // 已有的注册信息
            ClientRegistration existing = new ClientRegistration();
            existing.setClientId("client-001");
            existing.setUserId("old-user");
            existing.setClientType("WEB");
            existing.setVersion("0.9.0");
            existing.setOnline(false);

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(existing));
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(Collections.emptyList());
            when(clientRepo.findByOnlineTrue()).thenReturn(Collections.emptyList());

            service.register("user-001", registerRequest);

            // 验证信息已更新（不重复创建，复用原对象）
            ArgumentCaptor<ClientRegistration> regCaptor = ArgumentCaptor.forClass(ClientRegistration.class);
            verify(clientRepo).save(regCaptor.capture());
            ClientRegistration savedReg = regCaptor.getValue();
            assertEquals("user-001", savedReg.getUserId(), "userId 应更新为新值");
            assertEquals("TAURI", savedReg.getClientType(), "clientType 应更新");
            assertEquals("1.0.0", savedReg.getVersion(), "version 应更新");
            assertTrue(savedReg.isOnline(), "重新注册后 online 应为 true");
        }

        @Test
        @DisplayName("shouldUpdateExistingInstanceWhenClientRegistersAgain - 重复注册时更新已有 AgentInstance")
        void shouldUpdateExistingInstanceWhenClientRegistersAgain() {
            // 已有 AgentInstance
            AgentInstance existingInstance = new AgentInstance();
            existingInstance.setId(50L);
            existingInstance.setClientId("client-001");
            existingInstance.setAgentCode("gemini-translate");
            existingInstance.setUserId("old-user");
            existingInstance.setRunning(false);

            when(clientRepo.findById("client-001")).thenReturn(Optional.empty());
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.of(existingInstance));
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(Collections.emptyList());
            when(clientRepo.findByOnlineTrue()).thenReturn(Collections.emptyList());

            service.register("user-001", registerRequest);

            // 验证使用原有 instance 对象更新（不重新创建）
            ArgumentCaptor<AgentInstance> instCaptor = ArgumentCaptor.forClass(AgentInstance.class);
            verify(instanceRepo, atLeastOnce()).save(instCaptor.capture());
            AgentInstance updated = instCaptor.getAllValues().stream()
                    .filter(i -> i.getId() != null && i.getId() == 50L)
                    .findFirst()
                    .orElse(null);
            assertNotNull(updated, "应该更新 id=50 的已有 AgentInstance");
            assertEquals("user-001", updated.getUserId());
            assertTrue(updated.isRunning(), "runningAgents 包含该 Agent 时应为 running=true");
        }
    }

    @Nested
    @DisplayName("register Capability 匹配场景")
    class CapabilityMatchingTests {

        @Test
        @DisplayName("shouldOnlyCreateInstancesForMatchingCapabilities - 仅为匹配 capability 的 Agent 创建实例")
        void shouldOnlyCreateInstancesForMatchingCapabilities() {
            // 客户端只上报 gemini-cli，不上报 notebooklm
            registerRequest.setEnabledCapabilities(List.of("gemini-cli"));

            when(clientRepo.findById("client-001")).thenReturn(Optional.empty());
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent, notebooklmAgent, noCapAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(Collections.emptyList());
            when(clientRepo.findByOnlineTrue()).thenReturn(Collections.emptyList());

            service.register("user-001", registerRequest);

            // 验证只为 gemini-translate 查询了 AgentInstance（notebooklm-reply 不匹配，noCapAgent 也不匹配因为 requiredCapability=null）
            verify(instanceRepo).findByClientIdAndAgentCode("client-001", "gemini-translate");
            verify(instanceRepo, never()).findByClientIdAndAgentCode("client-001", "notebooklm-reply");
            verify(instanceRepo, never()).findByClientIdAndAgentCode("client-001", "server-agent");
        }

        @Test
        @DisplayName("shouldCreateMultipleInstancesWhenMultipleCapabilitiesMatch - 多 capability 匹配时创建多个实例")
        void shouldCreateMultipleInstancesWhenMultipleCapabilitiesMatch() {
            // 客户端上报了 gemini-cli 和 notebooklm
            registerRequest.setEnabledCapabilities(List.of("gemini-cli", "notebooklm"));
            registerRequest.setRunningAgents(List.of("gemini-translate", "notebooklm-reply"));

            when(clientRepo.findById("client-001")).thenReturn(Optional.empty());
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent, notebooklmAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "notebooklm-reply"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(Collections.emptyList());
            when(clientRepo.findByOnlineTrue()).thenReturn(Collections.emptyList());

            service.register("user-001", registerRequest);

            // 应该为两个 Agent 都查询了实例
            verify(instanceRepo).findByClientIdAndAgentCode("client-001", "gemini-translate");
            verify(instanceRepo).findByClientIdAndAgentCode("client-001", "notebooklm-reply");
        }

        @Test
        @DisplayName("shouldMarkUnmatchedInstancesAsNotRunning - 不匹配的现有实例应标记为 running=false")
        void shouldMarkUnmatchedInstancesAsNotRunning() {
            // 客户端只上报 gemini-cli，但已有一个 notebooklm 实例
            registerRequest.setEnabledCapabilities(List.of("gemini-cli"));

            AgentInstance oldNotebooklmInstance = new AgentInstance();
            oldNotebooklmInstance.setId(99L);
            oldNotebooklmInstance.setClientId("client-001");
            oldNotebooklmInstance.setAgentCode("notebooklm-reply");
            oldNotebooklmInstance.setRunning(true);

            when(clientRepo.findById("client-001")).thenReturn(Optional.empty());
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(definitionRepo.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(geminiAgent, notebooklmAgent));
            when(instanceRepo.findByClientIdAndAgentCode("client-001", "gemini-translate"))
                    .thenReturn(Optional.empty());
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));
            // 现有实例中有一个不匹配的 notebooklm 实例
            when(instanceRepo.findByClientId("client-001")).thenReturn(List.of(oldNotebooklmInstance));
            when(clientRepo.findByOnlineTrue()).thenReturn(Collections.emptyList());

            service.register("user-001", registerRequest);

            // 不匹配的实例应被标记为 running=false
            ArgumentCaptor<AgentInstance> instCaptor = ArgumentCaptor.forClass(AgentInstance.class);
            verify(instanceRepo, atLeastOnce()).save(instCaptor.capture());
            List<AgentInstance> savedInstances = instCaptor.getAllValues();
            boolean notebooklmMarkedNotRunning = savedInstances.stream()
                    .anyMatch(i -> i.getId() != null && i.getId() == 99L && !i.isRunning());
            assertTrue(notebooklmMarkedNotRunning, "不匹配的 notebooklm 实例应被标记为 running=false");
        }
    }

    @Nested
    @DisplayName("heartbeat 心跳更新场景")
    class HeartbeatTests {

        @Test
        @DisplayName("shouldUpdateHeartbeatAndOnlineStatusWhenClientExists - 心跳更新 lastHeartbeat 和 online 状态")
        void shouldUpdateHeartbeatAndOnlineStatusWhenClientExists() {
            ClientRegistration existing = new ClientRegistration();
            existing.setClientId("client-001");
            existing.setUserId("user-001");
            existing.setOnline(false); // 模拟之前离线
            existing.setLastHeartbeat(LocalDateTime.now().minusMinutes(5));

            ClientHeartbeatRequest heartbeatReq = new ClientHeartbeatRequest();
            heartbeatReq.setClientId("client-001");
            heartbeatReq.setRunningAgents(List.of("gemini-translate"));

            AgentInstance instance = new AgentInstance();
            instance.setId(10L);
            instance.setClientId("client-001");
            instance.setAgentCode("gemini-translate");
            instance.setRunning(false);

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(existing));
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(List.of(instance));
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));

            ClientHeartbeatResponse response = service.heartbeat("user-001", heartbeatReq);

            assertNotNull(response);
            assertNotNull(response.getServerTime());

            // 验证 ClientRegistration 被更新
            ArgumentCaptor<ClientRegistration> regCaptor = ArgumentCaptor.forClass(ClientRegistration.class);
            verify(clientRepo).save(regCaptor.capture());
            assertTrue(regCaptor.getValue().isOnline(), "心跳后 online 应为 true");
            assertNotNull(regCaptor.getValue().getLastHeartbeat(), "lastHeartbeat 应被更新");
        }

        @Test
        @DisplayName("shouldUpdateInstanceRunningStatusOnHeartbeat - 心跳更新 AgentInstance running 状态")
        void shouldUpdateInstanceRunningStatusOnHeartbeat() {
            ClientRegistration existing = new ClientRegistration();
            existing.setClientId("client-001");
            existing.setOnline(true);

            ClientHeartbeatRequest heartbeatReq = new ClientHeartbeatRequest();
            heartbeatReq.setClientId("client-001");
            heartbeatReq.setRunningAgents(List.of("gemini-translate")); // 只有 gemini-translate 在运行

            AgentInstance geminiInstance = new AgentInstance();
            geminiInstance.setId(10L);
            geminiInstance.setClientId("client-001");
            geminiInstance.setAgentCode("gemini-translate");
            geminiInstance.setRunning(false);

            AgentInstance notebooklmInstance = new AgentInstance();
            notebooklmInstance.setId(11L);
            notebooklmInstance.setClientId("client-001");
            notebooklmInstance.setAgentCode("notebooklm-reply");
            notebooklmInstance.setRunning(true); // 之前在运行，现在停止了

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(existing));
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(List.of(geminiInstance, notebooklmInstance));
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));

            service.heartbeat("user-001", heartbeatReq);

            // 验证两个实例都被保存，状态正确
            ArgumentCaptor<AgentInstance> instCaptor = ArgumentCaptor.forClass(AgentInstance.class);
            verify(instanceRepo, times(2)).save(instCaptor.capture());
            List<AgentInstance> savedInstances = instCaptor.getAllValues();

            AgentInstance savedGemini = savedInstances.stream()
                    .filter(i -> "gemini-translate".equals(i.getAgentCode())).findFirst().orElse(null);
            AgentInstance savedNotebook = savedInstances.stream()
                    .filter(i -> "notebooklm-reply".equals(i.getAgentCode())).findFirst().orElse(null);

            assertNotNull(savedGemini);
            assertTrue(savedGemini.isRunning(), "gemini-translate 应为 running=true");

            assertNotNull(savedNotebook);
            assertFalse(savedNotebook.isRunning(), "notebooklm-reply 不在 runningAgents 中，应为 running=false");
        }

        @Test
        @DisplayName("shouldUpdateLastHeartbeatOnAllInstancesOnHeartbeat - 心跳更新所有实例的 lastHeartbeat")
        void shouldUpdateLastHeartbeatOnAllInstancesOnHeartbeat() {
            ClientRegistration existing = new ClientRegistration();
            existing.setClientId("client-001");
            existing.setOnline(true);

            ClientHeartbeatRequest heartbeatReq = new ClientHeartbeatRequest();
            heartbeatReq.setClientId("client-001");
            heartbeatReq.setRunningAgents(Collections.emptyList());

            AgentInstance instance = new AgentInstance();
            instance.setId(10L);
            instance.setClientId("client-001");
            instance.setAgentCode("gemini-translate");
            instance.setLastHeartbeat(LocalDateTime.now().minusMinutes(2));

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(existing));
            when(clientRepo.save(any(ClientRegistration.class))).thenAnswer(inv -> inv.getArgument(0));
            when(instanceRepo.findByClientId("client-001")).thenReturn(List.of(instance));
            when(instanceRepo.save(any(AgentInstance.class))).thenAnswer(inv -> inv.getArgument(0));

            service.heartbeat("user-001", heartbeatReq);

            // 验证实例 lastHeartbeat 被刷新
            ArgumentCaptor<AgentInstance> instCaptor = ArgumentCaptor.forClass(AgentInstance.class);
            verify(instanceRepo).save(instCaptor.capture());
            assertNotNull(instCaptor.getValue().getLastHeartbeat());
        }

        @Test
        @DisplayName("shouldThrowClientNotFoundWhenHeartbeatForUnregisteredClient - 未注册客户端心跳抛 CLIENT_NOT_FOUND")
        void shouldThrowClientNotFoundWhenHeartbeatForUnregisteredClient() {
            ClientHeartbeatRequest heartbeatReq = new ClientHeartbeatRequest();
            heartbeatReq.setClientId("nonexistent-client");

            when(clientRepo.findById("nonexistent-client")).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.heartbeat("user-001", heartbeatReq));

            assertEquals(ErrorCode.CLIENT_NOT_FOUND, ex.getErrorCode());
            verify(clientRepo, never()).save(any());
            verify(instanceRepo, never()).findByClientId(any());
        }
    }

    @Nested
    @DisplayName("isClientOnline 场景")
    class IsClientOnlineTests {

        @Test
        @DisplayName("shouldReturnTrueWhenClientIsOnlineAndHeartbeatRecent - 在线且心跳新鲜时返回 true")
        void shouldReturnTrueWhenClientIsOnlineAndHeartbeatRecent() {
            ClientRegistration reg = new ClientRegistration();
            reg.setClientId("client-001");
            reg.setOnline(true);
            reg.setLastHeartbeat(LocalDateTime.now().minusSeconds(30)); // 30秒内

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(reg));

            assertTrue(service.isClientOnline("client-001"));
        }

        @Test
        @DisplayName("shouldReturnFalseWhenClientHeartbeatExpired - 心跳超过 60 秒返回 false")
        void shouldReturnFalseWhenClientHeartbeatExpired() {
            ClientRegistration reg = new ClientRegistration();
            reg.setClientId("client-001");
            reg.setOnline(true);
            reg.setLastHeartbeat(LocalDateTime.now().minusSeconds(120)); // 超时

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(reg));

            assertFalse(service.isClientOnline("client-001"));
        }

        @Test
        @DisplayName("shouldReturnFalseWhenClientNotRegistered - 未注册的客户端返回 false")
        void shouldReturnFalseWhenClientNotRegistered() {
            when(clientRepo.findById("nonexistent")).thenReturn(Optional.empty());

            assertFalse(service.isClientOnline("nonexistent"));
        }

        @Test
        @DisplayName("shouldReturnFalseWhenClientMarkedOffline - online=false 时返回 false")
        void shouldReturnFalseWhenClientMarkedOffline() {
            ClientRegistration reg = new ClientRegistration();
            reg.setClientId("client-001");
            reg.setOnline(false); // 已标记为离线
            reg.setLastHeartbeat(LocalDateTime.now().minusSeconds(10));

            when(clientRepo.findById("client-001")).thenReturn(Optional.of(reg));

            assertFalse(service.isClientOnline("client-001"));
        }
    }
}
