package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.CapabilityRouteResult;
import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.entity.ClientRegistration;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
import com.jefflower.fdserver.ai.repository.ClientRegistrationRepository;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
@DisplayName("CapabilityRouterService 单元测试")
class CapabilityRouterServiceTest {

    @Mock
    private AgentDefinitionRepository agentDefinitionRepository;

    @Mock
    private AgentInstanceRepository agentInstanceRepository;

    @Mock
    private ClientRegistrationRepository clientRegistrationRepository;

    @Mock
    private CapabilityDefinitionRepository capabilityDefinitionRepository;

    @InjectMocks
    private CapabilityRouterService capabilityRouterService;

    // --- 测试数据 ---
    private AgentDefinition agentDef;
    private AgentInstance agentInstance;
    private CapabilityDefinition capabilityDefinition;
    private ClientRegistration clientRegistration;

    @BeforeEach
    void setUp() {
        agentDef = new AgentDefinition();
        agentDef.setId(1L);
        agentDef.setCode("gemini-translate");
        agentDef.setName("Gemini 翻译");
        agentDef.setCapability("translation");
        agentDef.setRequiredCapability("gemini-cli");
        agentDef.setProviderType(ProviderType.GEMINI_CLI);
        agentDef.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        agentDef.setEnabled(true);
        agentDef.setSortOrder(1);

        agentInstance = new AgentInstance();
        agentInstance.setId(10L);
        agentInstance.setClientId("client-001");
        agentInstance.setUserId("user-001");
        agentInstance.setAgentCode("gemini-translate");
        agentInstance.setRunning(true);
        agentInstance.setLastHeartbeat(LocalDateTime.now().minusSeconds(10));

        capabilityDefinition = new CapabilityDefinition();
        capabilityDefinition.setId(100L);
        capabilityDefinition.setCode("gemini-cli");
        capabilityDefinition.setName("Gemini CLI");
        capabilityDefinition.setEnabled(true);

        clientRegistration = new ClientRegistration();
        clientRegistration.setClientId("client-001");
        clientRegistration.setUserId("user-001");
        clientRegistration.setOnline(true);
        clientRegistration.setEnabledCapabilities("gemini-cli,notebooklm");
        clientRegistration.setLastHeartbeat(LocalDateTime.now().minusSeconds(10));
    }

    @Nested
    @DisplayName("正常路由场景")
    class NormalRouteTests {

        @Test
        @DisplayName("shouldReturnRouteResultWhenAllConditionsMet - 完整正常路由链路")
        void shouldReturnRouteResultWhenAllConditionsMet() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            CapabilityRouteResult result = capabilityRouterService.route("translation", null, null);

            assertNotNull(result);
            assertEquals("gemini-translate", result.getAgentCode());
            assertEquals("client-001", result.getClientId());
            assertEquals("user-001", result.getUserId());
            assertEquals("gemini-cli", result.getRequiredCapability());
            assertNotNull(result.getAgentDefinition());
            assertNotNull(result.getAgentInstance());

            verify(agentDefinitionRepository).findByCapabilityAndEnabledTrueOrderBySortOrder("translation");
            verify(capabilityDefinitionRepository).findByCode("gemini-cli");
            verify(agentInstanceRepository).findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class));
            verify(clientRegistrationRepository).findById("client-001");
        }

        @Test
        @DisplayName("shouldRouteSuccessfullyWhenAgentHasNoRequiredCapability - Agent 无 requiredCapability 时直接路由")
        void shouldRouteSuccessfullyWhenAgentHasNoRequiredCapability() {
            agentDef.setRequiredCapability(null);
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));

            CapabilityRouteResult result = capabilityRouterService.route("translation", null, null);

            assertNotNull(result);
            assertEquals("gemini-translate", result.getAgentCode());
            assertEquals("client-001", result.getClientId());
            // 无 requiredCapability 时不查询 CapabilityDefinitionRepository
            verify(capabilityDefinitionRepository, never()).findByCode(any());
            // 无 requiredCapability 时不查询 ClientRegistration
            verify(clientRegistrationRepository, never()).findById(any());
        }
    }

    @Nested
    @DisplayName("无 Agent 场景")
    class NoAgentTests {

        @Test
        @DisplayName("shouldThrowCapabilityNoAgentWhenNoEnabledAgentFound - capability 无对应 Agent")
        void shouldThrowCapabilityNoAgentWhenNoEnabledAgentFound() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("unknown-capability"))
                    .thenReturn(Collections.emptyList());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("unknown-capability", null, null));

            assertEquals(ErrorCode.CAPABILITY_NO_AGENT, ex.getErrorCode());
            verify(agentDefinitionRepository).findByCapabilityAndEnabledTrueOrderBySortOrder("unknown-capability");
            // 没有 Agent 时不再查询后续
            verify(capabilityDefinitionRepository, never()).findByCode(any());
            verify(agentInstanceRepository, never()).findOnlineInstancesByAgentCode(any(), any());
        }
    }

    @Nested
    @DisplayName("Capability 禁用场景")
    class CapabilityDisabledTests {

        @Test
        @DisplayName("shouldThrowCapabilityDisabledWhenRequiredCapabilityIsDisabled - requiredCapability 已禁用")
        void shouldThrowCapabilityDisabledWhenRequiredCapabilityIsDisabled() {
            capabilityDefinition.setEnabled(false);

            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.CAPABILITY_DISABLED, ex.getErrorCode());
            // Instance 查询不应被触发
            verify(agentInstanceRepository, never()).findOnlineInstancesByAgentCode(any(), any());
        }

        @Test
        @DisplayName("shouldThrowCapabilityDisabledWhenRequiredCapabilityNotFound - requiredCapability 不存在")
        void shouldThrowCapabilityDisabledWhenRequiredCapabilityNotFound() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.CAPABILITY_DISABLED, ex.getErrorCode());
        }
    }

    @Nested
    @DisplayName("无在线客户端场景")
    class NoClientAvailableTests {

        @Test
        @DisplayName("shouldThrowNoClientAvailableWhenNoOnlineInstance - 有 Agent 但无在线实例")
        void shouldThrowNoClientAvailableWhenNoOnlineInstance() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(Collections.emptyList());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
        }

        @Test
        @DisplayName("shouldThrowNoClientAvailableWhenClientRegistrationNotFound - ClientRegistration 不存在")
        void shouldThrowNoClientAvailableWhenClientRegistrationNotFound() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
        }

        @Test
        @DisplayName("shouldThrowNoClientAvailableWhenClientIsOffline - 客户端 online=false")
        void shouldThrowNoClientAvailableWhenClientIsOffline() {
            clientRegistration.setOnline(false);
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
        }
    }

    @Nested
    @DisplayName("targetClientId 过滤场景")
    class TargetClientIdFilterTests {

        @Test
        @DisplayName("shouldRouteToSpecifiedClientWhenTargetClientIdMatches - targetClientId 匹配时路由成功")
        void shouldRouteToSpecifiedClientWhenTargetClientIdMatches() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            CapabilityRouteResult result = capabilityRouterService.route("translation", "client-001", null);

            assertNotNull(result);
            assertEquals("client-001", result.getClientId());
        }

        @Test
        @DisplayName("shouldThrowNoClientAvailableWhenTargetClientIdNotMatches - targetClientId 不匹配时跳过")
        void shouldThrowNoClientAvailableWhenTargetClientIdNotMatches() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            // agentInstance.clientId = "client-001", 指定 targetClientId = "client-999" 不匹配

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", "client-999", null));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
            // targetClientId 不匹配时直接跳过 instance，不查询 ClientRegistration
            verify(clientRegistrationRepository, never()).findById(any());
        }
    }

    @Nested
    @DisplayName("targetUserId 过滤场景")
    class TargetUserIdFilterTests {

        @Test
        @DisplayName("shouldRouteToSpecifiedUserWhenTargetUserIdMatches - targetUserId 匹配时路由成功")
        void shouldRouteToSpecifiedUserWhenTargetUserIdMatches() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            CapabilityRouteResult result = capabilityRouterService.route("translation", null, "user-001");

            assertNotNull(result);
            assertEquals("user-001", result.getUserId());
        }

        @Test
        @DisplayName("shouldThrowNoClientAvailableWhenTargetUserIdNotMatches - targetUserId 不匹配时跳过")
        void shouldThrowNoClientAvailableWhenTargetUserIdNotMatches() {
            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            // agentInstance.userId = "user-001", 指定 targetUserId = "user-999" 不匹配

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, "user-999"));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
            verify(clientRegistrationRepository, never()).findById(any());
        }
    }

    @Nested
    @DisplayName("客户端未启用 requiredCapability 场景")
    class ClientCapabilityNotEnabledTests {

        @Test
        @DisplayName("shouldSkipInstanceWhenClientNotReportRequiredCapability - 客户端未上报所需 capability")
        void shouldSkipInstanceWhenClientNotReportRequiredCapability() {
            // 客户端只上报了 notebooklm，没有上报 gemini-cli
            clientRegistration.setEnabledCapabilities("notebooklm,other-cap");

            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
        }

        @Test
        @DisplayName("shouldSkipInstanceWhenClientHasEmptyEnabledCapabilities - 客户端 enabledCapabilities 为空")
        void shouldSkipInstanceWhenClientHasEmptyEnabledCapabilities() {
            clientRegistration.setEnabledCapabilities(null);

            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(agentInstance));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> capabilityRouterService.route("translation", null, null));

            assertEquals(ErrorCode.NO_CLIENT_AVAILABLE, ex.getErrorCode());
        }

        @Test
        @DisplayName("shouldRouteToFirstMatchingInstanceWhenMultipleInstancesExist - 多实例时选第一个满足条件的")
        void shouldRouteToFirstMatchingInstanceWhenMultipleInstancesExist() {
            // 第一个实例不满足：客户端未启用 gemini-cli
            AgentInstance instance1 = new AgentInstance();
            instance1.setId(11L);
            instance1.setClientId("client-no-cap");
            instance1.setUserId("user-002");
            instance1.setAgentCode("gemini-translate");
            instance1.setRunning(true);
            instance1.setLastHeartbeat(LocalDateTime.now().minusSeconds(5));

            ClientRegistration reg1 = new ClientRegistration();
            reg1.setClientId("client-no-cap");
            reg1.setOnline(true);
            reg1.setEnabledCapabilities("other-cap");

            // 第二个实例满足条件
            AgentInstance instance2 = agentInstance; // clientId = client-001

            when(agentDefinitionRepository.findByCapabilityAndEnabledTrueOrderBySortOrder("translation"))
                    .thenReturn(List.of(agentDef));
            when(capabilityDefinitionRepository.findByCode("gemini-cli"))
                    .thenReturn(Optional.of(capabilityDefinition));
            when(agentInstanceRepository.findOnlineInstancesByAgentCode(eq("gemini-translate"), any(LocalDateTime.class)))
                    .thenReturn(List.of(instance1, instance2));
            when(clientRegistrationRepository.findById("client-no-cap"))
                    .thenReturn(Optional.of(reg1));
            when(clientRegistrationRepository.findById("client-001"))
                    .thenReturn(Optional.of(clientRegistration));

            CapabilityRouteResult result = capabilityRouterService.route("translation", null, null);

            assertNotNull(result);
            // 应该路由到第二个实例（client-001），跳过第一个不满足的
            assertEquals("client-001", result.getClientId());
        }
    }
}
