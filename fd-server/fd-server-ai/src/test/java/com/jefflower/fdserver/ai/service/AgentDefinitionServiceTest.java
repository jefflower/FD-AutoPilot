package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AgentDefinitionServiceTest {

    @Mock
    private AgentDefinitionRepository repository;

    @InjectMocks
    private AgentDefinitionService service;

    private AgentDefinition enabledAgent;
    private AgentDefinition disabledAgent;
    private AgentDefinition builtInAgent;

    @BeforeEach
    void setUp() {
        enabledAgent = new AgentDefinition();
        enabledAgent.setId(1L);
        enabledAgent.setCode("gemini-translate");
        enabledAgent.setName("Gemini 翻译");
        enabledAgent.setCapability("translate");
        enabledAgent.setProviderType(ProviderType.LOCAL_CLI);
        enabledAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        enabledAgent.setEnabled(true);
        enabledAgent.setBuiltIn(false);
        enabledAgent.setSortOrder(1);

        disabledAgent = new AgentDefinition();
        disabledAgent.setId(2L);
        disabledAgent.setCode("disabled-agent");
        disabledAgent.setName("禁用 Agent");
        disabledAgent.setCapability("translate");
        disabledAgent.setProviderType(ProviderType.HTTP_API);
        disabledAgent.setExecutionEnv(ExecutionEnv.SERVER_ONLY);
        disabledAgent.setEnabled(false);
        disabledAgent.setBuiltIn(false);
        disabledAgent.setSortOrder(2);

        builtInAgent = new AgentDefinition();
        builtInAgent.setId(3L);
        builtInAgent.setCode("notebooklm-reply");
        builtInAgent.setName("NotebookLM 回复");
        builtInAgent.setCapability("reply");
        builtInAgent.setProviderType(ProviderType.SHADOW_WINDOW);
        builtInAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        builtInAgent.setEnabled(true);
        builtInAgent.setBuiltIn(true);
        builtInAgent.setSortOrder(3);
    }

    // ========== findAll ==========

    @Test
    void findAll_returnsAllAgentsSorted() {
        when(repository.findAllByOrderBySortOrder())
                .thenReturn(List.of(enabledAgent, disabledAgent, builtInAgent));

        List<AgentDefinition> result = service.findAll();

        assertEquals(3, result.size());
        assertEquals("gemini-translate", result.get(0).getCode());
        assertEquals("disabled-agent", result.get(1).getCode());
        assertEquals("notebooklm-reply", result.get(2).getCode());
        verify(repository).findAllByOrderBySortOrder();
    }

    // ========== findEnabled ==========

    @Test
    void findEnabled_returnsOnlyEnabledAgents() {
        when(repository.findByEnabledTrueOrderBySortOrder())
                .thenReturn(List.of(enabledAgent, builtInAgent));

        List<AgentDefinition> result = service.findEnabled();

        assertEquals(2, result.size());
        assertTrue(result.stream().allMatch(AgentDefinition::isEnabled));
        verify(repository).findByEnabledTrueOrderBySortOrder();
    }

    // ========== findByCapability ==========

    @Test
    void findByCapability_returnsMatchingAgents() {
        when(repository.findByCapabilityAndEnabledTrueOrderBySortOrder("translate"))
                .thenReturn(List.of(enabledAgent));

        List<AgentDefinition> result = service.findByCapability("translate");

        assertEquals(1, result.size());
        assertEquals("translate", result.get(0).getCapability());
        verify(repository).findByCapabilityAndEnabledTrueOrderBySortOrder("translate");
    }

    // ========== findByCode ==========

    @Test
    void findByCode_returnsAgentWhenExists() {
        when(repository.findByCode("gemini-translate")).thenReturn(Optional.of(enabledAgent));

        Optional<AgentDefinition> result = service.findByCode("gemini-translate");

        assertTrue(result.isPresent());
        assertEquals("gemini-translate", result.get().getCode());
    }

    @Test
    void findByCode_returnsEmptyWhenNotExists() {
        when(repository.findByCode("nonexistent")).thenReturn(Optional.empty());

        Optional<AgentDefinition> result = service.findByCode("nonexistent");

        assertFalse(result.isPresent());
    }

    // ========== create ==========

    @Test
    void create_success() {
        AgentDefinition newDef = new AgentDefinition();
        newDef.setCode("new-agent");
        newDef.setName("新 Agent");
        newDef.setCapability("custom");
        newDef.setProviderType(ProviderType.HTTP_API);
        newDef.setExecutionEnv(ExecutionEnv.SERVER_ONLY);

        when(repository.existsByCode("new-agent")).thenReturn(false);
        when(repository.save(any(AgentDefinition.class))).thenAnswer(inv -> {
            AgentDefinition saved = inv.getArgument(0);
            saved.setId(10L);
            return saved;
        });

        AgentDefinition result = service.create(newDef);

        assertNotNull(result);
        assertEquals("new-agent", result.getCode());

        ArgumentCaptor<AgentDefinition> captor = ArgumentCaptor.forClass(AgentDefinition.class);
        verify(repository).save(captor.capture());
        assertEquals("new-agent", captor.getValue().getCode());
    }

    @Test
    void create_duplicateCode_throwsException() {
        AgentDefinition newDef = new AgentDefinition();
        newDef.setCode("gemini-translate");

        when(repository.existsByCode("gemini-translate")).thenReturn(true);

        BusinessException ex = assertThrows(BusinessException.class, () -> service.create(newDef));
        assertEquals(ErrorCode.INVALID_PARAMETER, ex.getErrorCode());
        verify(repository, never()).save(any());
    }

    // ========== update ==========

    @Test
    void update_success_preservesCodeAndBuiltIn() {
        AgentDefinition updated = new AgentDefinition();
        updated.setName("更新后名称");
        updated.setDescription("新描述");
        updated.setProviderType(ProviderType.HTTP_API);
        updated.setExecutionEnv(ExecutionEnv.BOTH);
        updated.setCapability("translate");
        updated.setProviderConfig("{\"model\":\"gemini-pro\"}");
        updated.setSortOrder(5);

        when(repository.findById(1L)).thenReturn(Optional.of(enabledAgent));
        when(repository.save(any(AgentDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

        AgentDefinition result = service.update(1L, updated);

        // 名称、描述等字段应被更新
        assertEquals("更新后名称", result.getName());
        assertEquals("新描述", result.getDescription());
        assertEquals(ProviderType.HTTP_API, result.getProviderType());
        assertEquals(ExecutionEnv.BOTH, result.getExecutionEnv());
        assertEquals(5, result.getSortOrder());

        // code 和 builtIn 不允许修改（保留原值）
        assertEquals("gemini-translate", result.getCode());
        assertFalse(result.isBuiltIn());
    }

    @Test
    void update_notFound_throwsException() {
        when(repository.findById(999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.update(999L, new AgentDefinition()));
        assertEquals(ErrorCode.AGENT_NOT_FOUND, ex.getErrorCode());
        verify(repository, never()).save(any());
    }

    // ========== toggleEnabled ==========

    @Test
    void toggleEnabled_togglesState() {
        // 初始状态: enabled = true
        when(repository.findById(1L)).thenReturn(Optional.of(enabledAgent));
        when(repository.save(any(AgentDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

        service.toggleEnabled(1L);

        ArgumentCaptor<AgentDefinition> captor = ArgumentCaptor.forClass(AgentDefinition.class);
        verify(repository).save(captor.capture());
        // enabled 应被翻转为 false
        assertFalse(captor.getValue().isEnabled());
    }

    @Test
    void toggleEnabled_notFound_throwsException() {
        when(repository.findById(999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class, () -> service.toggleEnabled(999L));
        assertEquals(ErrorCode.AGENT_NOT_FOUND, ex.getErrorCode());
        verify(repository, never()).save(any());
    }

    // ========== delete ==========

    @Test
    void delete_success_nonBuiltIn() {
        when(repository.findById(1L)).thenReturn(Optional.of(enabledAgent));

        service.delete(1L);

        verify(repository).delete(enabledAgent);
    }

    @Test
    void delete_builtIn_throwsException() {
        when(repository.findById(3L)).thenReturn(Optional.of(builtInAgent));

        BusinessException ex = assertThrows(BusinessException.class, () -> service.delete(3L));
        assertEquals(ErrorCode.INVALID_PARAMETER, ex.getErrorCode());
        verify(repository, never()).delete(any());
    }

    @Test
    void delete_notFound_throwsException() {
        when(repository.findById(999L)).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class, () -> service.delete(999L));
        assertEquals(ErrorCode.AGENT_NOT_FOUND, ex.getErrorCode());
        verify(repository, never()).delete(any());
    }
}
