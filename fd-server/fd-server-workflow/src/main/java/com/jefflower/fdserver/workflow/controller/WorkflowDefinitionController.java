package com.jefflower.fdserver.workflow.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.workflow.entity.WorkflowDefinition;
import com.jefflower.fdserver.workflow.repository.WorkflowDefinitionRepository;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/workflows/definitions")
public class WorkflowDefinitionController {

    private final WorkflowDefinitionRepository repository;
    private final WorkflowService workflowService;

    public WorkflowDefinitionController(WorkflowDefinitionRepository repository,
                                         WorkflowService workflowService) {
        this.repository = repository;
        this.workflowService = workflowService;
    }

    @GetMapping
    @RequiresPermission("workflow:manage")
    public ApiResponse<List<WorkflowDefinition>> listAll() {
        return ApiResponse.ok(repository.findAllByOrderByCreatedAtDesc());
    }

    @GetMapping("/type/{businessType}")
    @RequiresPermission("workflow:manage")
    public ApiResponse<List<WorkflowDefinition>> listByBusinessType(@PathVariable String businessType) {
        return ApiResponse.ok(repository.findByBusinessTypeAndEnabledTrue(businessType));
    }

    @PostMapping
    @RequiresPermission("workflow:manage")
    public ApiResponse<WorkflowDefinition> create(@RequestBody WorkflowDefinition def) {
        if (repository.existsByProcessKey(def.getProcessKey())) {
            throw new BusinessException(ErrorCode.WORKFLOW_ALREADY_EXISTS,
                    "流程定义已存在: " + def.getProcessKey());
        }
        return ApiResponse.ok("流程定义创建成功", repository.save(def));
    }

    @PutMapping("/{id}")
    @RequiresPermission("workflow:manage")
    public ApiResponse<WorkflowDefinition> update(@PathVariable Long id,
                                                    @RequestBody WorkflowDefinition updated) {
        WorkflowDefinition existing = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_NOT_FOUND));
        existing.setName(updated.getName());
        existing.setDescription(updated.getDescription());
        existing.setBusinessType(updated.getBusinessType());
        existing.setEnabled(updated.isEnabled());
        return ApiResponse.ok("流程定义更新成功", repository.save(existing));
    }

    @PostMapping("/{id}/deploy")
    @RequiresPermission("workflow:deploy")
    public ApiResponse<Void> deploy(@PathVariable Long id) {
        workflowService.deployDefinition(id);
        return ApiResponse.ok("流程部署成功", null);
    }

    @GetMapping("/{id}/bpmn")
    @RequiresPermission("workflow:design")
    public ApiResponse<Map<String, String>> getBpmnXml(@PathVariable Long id) {
        WorkflowDefinition def = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_NOT_FOUND));
        return ApiResponse.ok(Map.of(
                "processKey", def.getProcessKey(),
                "bpmnXml", def.getBpmnXml() != null ? def.getBpmnXml() : ""
        ));
    }

    @PutMapping("/{id}/bpmn")
    @RequiresPermission("workflow:design")
    public ApiResponse<Void> saveBpmnXml(@PathVariable Long id, @RequestBody Map<String, String> body) {
        WorkflowDefinition def = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_NOT_FOUND));
        def.setBpmnXml(body.get("bpmnXml"));
        repository.save(def);
        return ApiResponse.ok("BPMN XML 保存成功", null);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission("workflow:manage")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        WorkflowDefinition def = repository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.WORKFLOW_NOT_FOUND));
        if (def.isBuiltIn()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "内置流程定义不可删除");
        }
        repository.delete(def);
        return ApiResponse.ok("流程定义删除成功", null);
    }
}
