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

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AgentBindingServiceTest {

    @Mock
    private AgentDefinitionRepository definitionRepository;

    @Mock
    private AgentBindingRepository bindingRepository;

    @InjectMocks
    private AgentBindingService service;

    private AgentDefinition translateAgent;
    private AgentDefinition replyAgent;

    @BeforeEach
    void setUp() {
        translateAgent = new AgentDefinition();
        translateAgent.setId(1L);
        translateAgent.setCode("gemini-translate");
        translateAgent.setName("Gemini 翻译");
        translateAgent.setCapability("translate");
        translateAgent.setProviderType(ProviderType.LOCAL_CLI);
        translateAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        translateAgent.setEnabled(true);
        translateAgent.setSortOrder(1);

        replyAgent = new AgentDefinition();
        replyAgent.setId(2L);
        replyAgent.setCode("notebooklm-reply");
        replyAgent.setName("NotebookLM 回复");
        replyAgent.setCapability("reply");
        replyAgent.setProviderType(ProviderType.SHADOW_WINDOW);
        replyAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        replyAgent.setEnabled(true);
        replyAgent.setSortOrder(2);
    }

    // ========== getAllBindings ==========

    @Test
    void getAllBindings_returnsAllMappings() {
        AgentBinding binding1 = new AgentBinding();
        binding1.setCapability("translate");
        binding1.setAgentCode("gemini-translate");

        AgentBinding binding2 = new AgentBinding();
        binding2.setCapability("reply");
        binding2.setAgentCode("notebooklm-reply");

        when(bindingRepository.findAll()).thenReturn(List.of(binding1, binding2));

        Map<String, String> result = service.getAllBindings();

        assertEquals(2, result.size());
        assertEquals("gemini-translate", result.get("translate"));
        assertEquals("notebooklm-reply", result.get("reply"));
        verify(bindingRepository).findAll();
    }

    @Test
    void getAllBindings_returnsEmptyMapWhenNoBindings() {
        when(bindingRepository.findAll()).thenReturn(Collections.emptyList());

        Map<String, String> result = service.getAllBindings();

        assertTrue(result.isEmpty());
    }

    // ========== getBinding ==========

    @Test
    void getBinding_returnsCodeWhenExists() {
        AgentBinding binding = new AgentBinding();
        binding.setCapability("translate");
        binding.setAgentCode("gemini-translate");

        when(bindingRepository.findByCapability("translate")).thenReturn(Optional.of(binding));

        String result = service.getBinding("translate");

        assertEquals("gemini-translate", result);
    }

    @Test
    void getBinding_returnsNullWhenNotExists() {
        when(bindingRepository.findByCapability("nonexistent")).thenReturn(Optional.empty());

        String result = service.getBinding("nonexistent");

        assertNull(result);
    }

    // ========== setBinding ==========

    @Test
    void setBinding_createsNewBinding() {
        when(definitionRepository.findByCode("gemini-translate")).thenReturn(Optional.of(translateAgent));
        when(bindingRepository.findByCapability("translate")).thenReturn(Optional.empty());
        when(bindingRepository.save(any(AgentBinding.class))).thenAnswer(inv -> inv.getArgument(0));

        service.setBinding("translate", "gemini-translate");

        ArgumentCaptor<AgentBinding> captor = ArgumentCaptor.forClass(AgentBinding.class);
        verify(bindingRepository).save(captor.capture());
        assertEquals("translate", captor.getValue().getCapability());
        assertEquals("gemini-translate", captor.getValue().getAgentCode());
    }

    @Test
    void setBinding_updatesExistingBinding() {
        AgentDefinition antigravityAgent = new AgentDefinition();
        antigravityAgent.setCode("antigravity-translate");
        antigravityAgent.setEnabled(true);

        AgentBinding existingBinding = new AgentBinding();
        existingBinding.setCapability("translate");
        existingBinding.setAgentCode("gemini-translate");

        when(definitionRepository.findByCode("antigravity-translate")).thenReturn(Optional.of(antigravityAgent));
        when(bindingRepository.findByCapability("translate")).thenReturn(Optional.of(existingBinding));
        when(bindingRepository.save(any(AgentBinding.class))).thenAnswer(inv -> inv.getArgument(0));

        service.setBinding("translate", "antigravity-translate");

        ArgumentCaptor<AgentBinding> captor = ArgumentCaptor.forClass(AgentBinding.class);
        verify(bindingRepository).save(captor.capture());
        // 能力键不变，agentCode 被更新
        assertEquals("translate", captor.getValue().getCapability());
        assertEquals("antigravity-translate", captor.getValue().getAgentCode());
    }

    @Test
    void setBinding_agentNotFound_throwsException() {
        when(definitionRepository.findByCode("unknown-agent")).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.setBinding("translate", "unknown-agent"));
        assertEquals(ErrorCode.AGENT_NOT_FOUND, ex.getErrorCode());
        verify(bindingRepository, never()).save(any());
    }

    // ========== removeBinding ==========

    @Test
    void removeBinding_deletesWhenExists() {
        AgentBinding binding = new AgentBinding();
        binding.setCapability("translate");
        binding.setAgentCode("gemini-translate");

        when(bindingRepository.findByCapability("translate")).thenReturn(Optional.of(binding));

        service.removeBinding("translate");

        verify(bindingRepository).delete(binding);
    }

    @Test
    void removeBinding_noopWhenNotExists() {
        when(bindingRepository.findByCapability("nonexistent")).thenReturn(Optional.empty());

        service.removeBinding("nonexistent");

        verify(bindingRepository, never()).delete(any());
    }

    // ========== resolveAgentCode ==========

    @Test
    void resolveAgentCode_prefersBoundAgent() {
        // 有明确绑定，优先返回绑定的 agentCode
        AgentBinding binding = new AgentBinding();
        binding.setCapability("translate");
        binding.setAgentCode("gemini-translate");

        when(bindingRepository.findByCapability("translate")).thenReturn(Optional.of(binding));

        String result = service.resolveAgentCode("translate");

        assertEquals("gemini-translate", result);
        // 无需查询 definition 列表
        verify(definitionRepository, never()).findByCapabilityAndEnabledTrueOrderBySortOrder(any());
    }

    @Test
    void resolveAgentCode_fallbackToFirstEnabled() {
        // 无绑定，回退到该 capability 下第一个启用的 Agent
        when(bindingRepository.findByCapability("translate")).thenReturn(Optional.empty());
        when(definitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translate"))
                .thenReturn(List.of(translateAgent, replyAgent));

        String result = service.resolveAgentCode("translate");

        assertEquals("gemini-translate", result);
    }

    @Test
    void resolveAgentCode_returnsNullWhenNoAgents() {
        // 无绑定且该 capability 下无可用 Agent
        when(bindingRepository.findByCapability("tracking")).thenReturn(Optional.empty());
        when(definitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("tracking"))
                .thenReturn(Collections.emptyList());

        String result = service.resolveAgentCode("tracking");

        assertNull(result);
    }
}
