package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.entity.AgentDefinition;
import com.jefflower.fdserver.ai.entity.CapabilityDefinition;
import com.jefflower.fdserver.ai.enums.ExecutionEnv;
import com.jefflower.fdserver.ai.enums.ProviderType;
import com.jefflower.fdserver.ai.repository.AgentDefinitionRepository;
import com.jefflower.fdserver.ai.repository.CapabilityDefinitionRepository;
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

import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("CapabilityDefinitionService 单元测试")
class CapabilityDefinitionServiceTest {

    @Mock
    private CapabilityDefinitionRepository repository;

    @Mock
    private AgentDefinitionRepository agentDefinitionRepository;

    @InjectMocks
    private CapabilityDefinitionService service;

    // --- 测试数据 ---
    private CapabilityDefinition enabledCap;
    private CapabilityDefinition disabledCap;
    private CapabilityDefinition builtInCap;
    private AgentDefinition dependentAgent1;
    private AgentDefinition dependentAgent2;
    private AgentDefinition alreadyDisabledAgent;

    @BeforeEach
    void setUp() {
        enabledCap = new CapabilityDefinition();
        enabledCap.setId(1L);
        enabledCap.setCode("gemini-cli");
        enabledCap.setName("Gemini CLI");
        enabledCap.setEnabled(true);
        enabledCap.setBuiltIn(false);
        enabledCap.setSortOrder(1);
        enabledCap.setProviderType(ProviderType.GEMINI_CLI);
        enabledCap.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);

        disabledCap = new CapabilityDefinition();
        disabledCap.setId(2L);
        disabledCap.setCode("notebooklm");
        disabledCap.setName("NotebookLM");
        disabledCap.setEnabled(false);
        disabledCap.setBuiltIn(false);
        disabledCap.setSortOrder(2);
        disabledCap.setProviderType(ProviderType.NOTEBOOKLM);
        disabledCap.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);

        builtInCap = new CapabilityDefinition();
        builtInCap.setId(3L);
        builtInCap.setCode("built-in-cap");
        builtInCap.setName("内置 Capability");
        builtInCap.setEnabled(true);
        builtInCap.setBuiltIn(true);
        builtInCap.setSortOrder(0);
        builtInCap.setProviderType(ProviderType.LOCAL_FUNCTION);
        builtInCap.setExecutionEnv(ExecutionEnv.SERVER_ONLY);

        dependentAgent1 = new AgentDefinition();
        dependentAgent1.setId(10L);
        dependentAgent1.setCode("gemini-translate");
        dependentAgent1.setRequiredCapability("gemini-cli");
        dependentAgent1.setEnabled(true);
        dependentAgent1.setProviderType(ProviderType.GEMINI_CLI);
        dependentAgent1.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        dependentAgent1.setCapability("translation");

        dependentAgent2 = new AgentDefinition();
        dependentAgent2.setId(11L);
        dependentAgent2.setCode("gemini-reply");
        dependentAgent2.setRequiredCapability("gemini-cli");
        dependentAgent2.setEnabled(true);
        dependentAgent2.setProviderType(ProviderType.GEMINI_CLI);
        dependentAgent2.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        dependentAgent2.setCapability("reply");

        alreadyDisabledAgent = new AgentDefinition();
        alreadyDisabledAgent.setId(12L);
        alreadyDisabledAgent.setCode("gemini-summary");
        alreadyDisabledAgent.setRequiredCapability("gemini-cli");
        alreadyDisabledAgent.setEnabled(false);
        alreadyDisabledAgent.setProviderType(ProviderType.GEMINI_CLI);
        alreadyDisabledAgent.setExecutionEnv(ExecutionEnv.CLIENT_ONLY);
        alreadyDisabledAgent.setCapability("summary");
    }

    // ========== getEnabledCapabilities ==========

    @Nested
    @DisplayName("getEnabledCapabilities 场景")
    class GetEnabledCapabilitiesTests {

        @Test
        @DisplayName("shouldReturnOnlyEnabledCapabilitiesOrderedBySortOrder - 只返回已启用的 Capability")
        void shouldReturnOnlyEnabledCapabilitiesOrderedBySortOrder() {
            when(repository.findByEnabledTrueOrderBySortOrder())
                    .thenReturn(List.of(enabledCap, builtInCap));

            List<CapabilityDefinition> result = service.getEnabledCapabilities();

            assertEquals(2, result.size());
            assertTrue(result.stream().allMatch(CapabilityDefinition::isEnabled));
            verify(repository).findByEnabledTrueOrderBySortOrder();
        }
    }

    // ========== getAllCapabilities ==========

    @Nested
    @DisplayName("getAllCapabilities 场景")
    class GetAllCapabilitiesTests {

        @Test
        @DisplayName("shouldReturnAllCapabilitiesOrderedBySortOrder - 返回全部 Capability")
        void shouldReturnAllCapabilitiesOrderedBySortOrder() {
            when(repository.findAllByOrderBySortOrder())
                    .thenReturn(List.of(builtInCap, enabledCap, disabledCap));

            List<CapabilityDefinition> result = service.getAllCapabilities();

            assertEquals(3, result.size());
            verify(repository).findAllByOrderBySortOrder();
        }
    }

    // ========== getByCode ==========

    @Nested
    @DisplayName("getByCode 场景")
    class GetByCodeTests {

        @Test
        @DisplayName("shouldReturnCapabilityWhenCodeExists - 按 code 查询成功")
        void shouldReturnCapabilityWhenCodeExists() {
            when(repository.findByCode("gemini-cli")).thenReturn(Optional.of(enabledCap));

            CapabilityDefinition result = service.getByCode("gemini-cli");

            assertNotNull(result);
            assertEquals("gemini-cli", result.getCode());
        }

        @Test
        @DisplayName("shouldThrowCapabilityNotFoundWhenCodeNotExists - code 不存在时抛 CAPABILITY_NOT_FOUND")
        void shouldThrowCapabilityNotFoundWhenCodeNotExists() {
            when(repository.findByCode("nonexistent")).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.getByCode("nonexistent"));

            assertEquals(ErrorCode.CAPABILITY_NOT_FOUND, ex.getErrorCode());
        }
    }

    // ========== create ==========

    @Nested
    @DisplayName("create CRUD 场景")
    class CreateTests {

        @Test
        @DisplayName("shouldCreateCapabilityWhenCodeIsUnique - code 唯一时创建成功")
        void shouldCreateCapabilityWhenCodeIsUnique() {
            CapabilityDefinition newCap = new CapabilityDefinition();
            newCap.setCode("new-capability");
            newCap.setName("新 Capability");
            newCap.setProviderType(ProviderType.HTTP_API);
            newCap.setExecutionEnv(ExecutionEnv.SERVER_ONLY);

            when(repository.existsByCode("new-capability")).thenReturn(false);
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> {
                CapabilityDefinition saved = inv.getArgument(0);
                saved.setId(99L);
                return saved;
            });

            CapabilityDefinition result = service.create(newCap);

            assertNotNull(result);
            assertEquals("new-capability", result.getCode());

            ArgumentCaptor<CapabilityDefinition> captor = ArgumentCaptor.forClass(CapabilityDefinition.class);
            verify(repository).save(captor.capture());
            assertEquals("new-capability", captor.getValue().getCode());
        }

        @Test
        @DisplayName("shouldThrowInvalidParameterWhenCodeAlreadyExists - code 重复时抛 INVALID_PARAMETER")
        void shouldThrowInvalidParameterWhenCodeAlreadyExists() {
            CapabilityDefinition newCap = new CapabilityDefinition();
            newCap.setCode("gemini-cli");

            when(repository.existsByCode("gemini-cli")).thenReturn(true);

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.create(newCap));

            assertEquals(ErrorCode.INVALID_PARAMETER, ex.getErrorCode());
            verify(repository, never()).save(any());
        }
    }

    // ========== update ==========

    @Nested
    @DisplayName("update CRUD 场景")
    class UpdateTests {

        @Test
        @DisplayName("shouldUpdateCapabilityFieldsWhenIdExists - 更新可修改字段")
        void shouldUpdateCapabilityFieldsWhenIdExists() {
            CapabilityDefinition updateData = new CapabilityDefinition();
            updateData.setName("Gemini CLI 更新版");
            updateData.setDescription("更新描述");
            updateData.setProviderType(ProviderType.HTTP_API);
            updateData.setSortOrder(10);

            when(repository.findById(1L)).thenReturn(Optional.of(enabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

            CapabilityDefinition result = service.update(1L, updateData);

            assertEquals("Gemini CLI 更新版", result.getName());
            assertEquals("更新描述", result.getDescription());
            assertEquals(ProviderType.HTTP_API, result.getProviderType());
            assertEquals(10, result.getSortOrder());
            // code 不可修改，保留原值
            assertEquals("gemini-cli", result.getCode());
            // builtIn 不可修改，保留原值
            assertFalse(result.isBuiltIn());
        }

        @Test
        @DisplayName("shouldThrowCapabilityNotFoundWhenIdNotExists - ID 不存在时抛 CAPABILITY_NOT_FOUND")
        void shouldThrowCapabilityNotFoundWhenIdNotExists() {
            when(repository.findById(999L)).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.update(999L, new CapabilityDefinition()));

            assertEquals(ErrorCode.CAPABILITY_NOT_FOUND, ex.getErrorCode());
            verify(repository, never()).save(any());
        }
    }

    // ========== delete ==========

    @Nested
    @DisplayName("delete CRUD 场景")
    class DeleteTests {

        @Test
        @DisplayName("shouldDeleteCapabilityWhenNotBuiltIn - 非内置 Capability 可删除")
        void shouldDeleteCapabilityWhenNotBuiltIn() {
            when(repository.findById(1L)).thenReturn(Optional.of(enabledCap));

            service.delete(1L);

            verify(repository).delete(enabledCap);
        }

        @Test
        @DisplayName("shouldThrowInvalidParameterWhenDeletingBuiltInCapability - 内置 Capability 不可删除")
        void shouldThrowInvalidParameterWhenDeletingBuiltInCapability() {
            when(repository.findById(3L)).thenReturn(Optional.of(builtInCap));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(3L));

            assertEquals(ErrorCode.INVALID_PARAMETER, ex.getErrorCode());
            verify(repository, never()).delete(any());
        }

        @Test
        @DisplayName("shouldThrowCapabilityNotFoundWhenDeletingNonExistentId - ID 不存在时抛 CAPABILITY_NOT_FOUND")
        void shouldThrowCapabilityNotFoundWhenDeletingNonExistentId() {
            when(repository.findById(999L)).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.delete(999L));

            assertEquals(ErrorCode.CAPABILITY_NOT_FOUND, ex.getErrorCode());
            verify(repository, never()).delete(any());
        }
    }

    // ========== toggleEnabled ==========

    @Nested
    @DisplayName("toggleEnabled 级联场景")
    class ToggleEnabledTests {

        @Test
        @DisplayName("shouldCascadeDisableAllRelatedAgentsWhenCapabilityDisabled - 禁用 Capability 级联禁用关联 Agent")
        void shouldCascadeDisableAllRelatedAgentsWhenCapabilityDisabled() {
            // enabledCap 当前 enabled = true，toggle 后变为 false
            when(repository.findById(1L)).thenReturn(Optional.of(enabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));
            // 关联两个已启用的 Agent + 一个已禁用的 Agent
            when(agentDefinitionRepository.findByRequiredCapability("gemini-cli"))
                    .thenReturn(List.of(dependentAgent1, dependentAgent2, alreadyDisabledAgent));
            when(agentDefinitionRepository.save(any(AgentDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

            service.toggleEnabled(1L);

            // 验证 Capability 自身被保存为 disabled
            ArgumentCaptor<CapabilityDefinition> capCaptor = ArgumentCaptor.forClass(CapabilityDefinition.class);
            verify(repository).save(capCaptor.capture());
            assertFalse(capCaptor.getValue().isEnabled());

            // 验证两个已启用的 Agent 被级联禁用
            ArgumentCaptor<AgentDefinition> agentCaptor = ArgumentCaptor.forClass(AgentDefinition.class);
            verify(agentDefinitionRepository, times(2)).save(agentCaptor.capture());
            List<AgentDefinition> savedAgents = agentCaptor.getAllValues();
            assertTrue(savedAgents.stream().allMatch(a -> !a.isEnabled()),
                    "所有被级联保存的 Agent 应该都是 disabled 状态");

            // 验证 alreadyDisabledAgent（已禁用的）不被重复保存
            verify(agentDefinitionRepository, times(2)).save(any());
        }

        @Test
        @DisplayName("shouldNotCascadeEnableAgentsWhenCapabilityEnabled - 启用 Capability 时 Agent 保持原状态")
        void shouldNotCascadeEnableAgentsWhenCapabilityEnabled() {
            // disabledCap 当前 enabled = false，toggle 后变为 true
            when(repository.findById(2L)).thenReturn(Optional.of(disabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

            service.toggleEnabled(2L);

            // 验证 Capability 被保存为 enabled
            ArgumentCaptor<CapabilityDefinition> capCaptor = ArgumentCaptor.forClass(CapabilityDefinition.class);
            verify(repository).save(capCaptor.capture());
            assertTrue(capCaptor.getValue().isEnabled());

            // 启用时不应查询也不应修改任何 Agent
            verify(agentDefinitionRepository, never()).findByRequiredCapability(any());
            verify(agentDefinitionRepository, never()).save(any());
        }

        @Test
        @DisplayName("shouldDisableCapabilityWithNoRelatedAgents - 禁用无关联 Agent 的 Capability")
        void shouldDisableCapabilityWithNoRelatedAgents() {
            when(repository.findById(1L)).thenReturn(Optional.of(enabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));
            // 没有关联的 Agent
            when(agentDefinitionRepository.findByRequiredCapability("gemini-cli"))
                    .thenReturn(Collections.emptyList());

            service.toggleEnabled(1L);

            // Capability 本身应被禁用
            ArgumentCaptor<CapabilityDefinition> capCaptor = ArgumentCaptor.forClass(CapabilityDefinition.class);
            verify(repository).save(capCaptor.capture());
            assertFalse(capCaptor.getValue().isEnabled());

            // 无 Agent 需要级联，不应调用 agentDefinitionRepository.save
            verify(agentDefinitionRepository, never()).save(any());
        }

        @Test
        @DisplayName("shouldToggleFromEnabledToDisabled - enabled=true 切换为 false")
        void shouldToggleFromEnabledToDisabled() {
            when(repository.findById(1L)).thenReturn(Optional.of(enabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));
            when(agentDefinitionRepository.findByRequiredCapability("gemini-cli"))
                    .thenReturn(Collections.emptyList());

            service.toggleEnabled(1L);

            ArgumentCaptor<CapabilityDefinition> captor = ArgumentCaptor.forClass(CapabilityDefinition.class);
            verify(repository).save(captor.capture());
            assertFalse(captor.getValue().isEnabled(), "enabled=true 应被翻转为 false");
        }

        @Test
        @DisplayName("shouldToggleFromDisabledToEnabled - enabled=false 切换为 true")
        void shouldToggleFromDisabledToEnabled() {
            when(repository.findById(2L)).thenReturn(Optional.of(disabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

            service.toggleEnabled(2L);

            ArgumentCaptor<CapabilityDefinition> captor = ArgumentCaptor.forClass(CapabilityDefinition.class);
            verify(repository).save(captor.capture());
            assertTrue(captor.getValue().isEnabled(), "enabled=false 应被翻转为 true");
        }

        @Test
        @DisplayName("shouldThrowCapabilityNotFoundWhenToggleNonExistentId - ID 不存在时抛 CAPABILITY_NOT_FOUND")
        void shouldThrowCapabilityNotFoundWhenToggleNonExistentId() {
            when(repository.findById(999L)).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> service.toggleEnabled(999L));

            assertEquals(ErrorCode.CAPABILITY_NOT_FOUND, ex.getErrorCode());
            verify(repository, never()).save(any());
            verify(agentDefinitionRepository, never()).findByRequiredCapability(any());
        }

        @Test
        @DisplayName("shouldOnlySaveEnabledAgentsWhenCascadeDisabling - 仅保存已启用的 Agent，跳过已禁用的")
        void shouldOnlySaveEnabledAgentsWhenCascadeDisabling() {
            when(repository.findById(1L)).thenReturn(Optional.of(enabledCap));
            when(repository.save(any(CapabilityDefinition.class))).thenAnswer(inv -> inv.getArgument(0));
            // 三个关联 Agent：两个已启用，一个已禁用
            when(agentDefinitionRepository.findByRequiredCapability("gemini-cli"))
                    .thenReturn(List.of(dependentAgent1, dependentAgent2, alreadyDisabledAgent));
            when(agentDefinitionRepository.save(any(AgentDefinition.class))).thenAnswer(inv -> inv.getArgument(0));

            service.toggleEnabled(1L);

            // 只有两个已启用的 Agent 被保存（alreadyDisabledAgent 跳过）
            verify(agentDefinitionRepository, times(2)).save(any(AgentDefinition.class));
        }
    }
}
