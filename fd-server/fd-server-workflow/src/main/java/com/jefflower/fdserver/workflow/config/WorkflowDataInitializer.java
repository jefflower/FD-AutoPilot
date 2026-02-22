package com.jefflower.fdserver.workflow.config;

import com.jefflower.fdserver.workflow.entity.WorkflowDefinition;
import com.jefflower.fdserver.workflow.repository.WorkflowDefinitionRepository;
import com.jefflower.fdserver.workflow.service.WorkflowService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Component
@Order(12)
public class WorkflowDataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(WorkflowDataInitializer.class);

    private final WorkflowDefinitionRepository repository;
    private final WorkflowService workflowService;

    public WorkflowDataInitializer(WorkflowDefinitionRepository repository,
                                    WorkflowService workflowService) {
        this.repository = repository;
        this.workflowService = workflowService;
    }

    @Override
    @Transactional
    public void run(String... args) {
        ensureBuiltInWorkflow(
                "ticket-standard-flow",
                "标准工单处理流程",
                "翻译 → 回复 → 审核的标准工单处理流程",
                "ticket",
                "bpmn/ticket-standard-flow.bpmn20.xml"
        );
    }

    private void ensureBuiltInWorkflow(String processKey, String name, String description,
                                        String businessType, String bpmnResource) {
        if (repository.existsByProcessKey(processKey)) {
            return;
        }

        String bpmnXml = loadBpmnResource(bpmnResource);

        WorkflowDefinition def = new WorkflowDefinition();
        def.setProcessKey(processKey);
        def.setName(name);
        def.setDescription(description);
        def.setBusinessType(businessType);
        def.setBpmnXml(bpmnXml);
        def.setEnabled(true);
        def.setBuiltIn(true);

        WorkflowDefinition saved = repository.save(def);
        log.info("[WorkflowDataInitializer] Created built-in workflow: {}", processKey);

        // 自动部署到 Flowable
        if (bpmnXml != null) {
            try {
                workflowService.deployDefinition(saved.getId());
                log.info("[WorkflowDataInitializer] Auto-deployed workflow: {}", processKey);
            } catch (Exception e) {
                log.warn("[WorkflowDataInitializer] Auto-deploy failed for {}: {}", processKey, e.getMessage());
            }
        }
    }

    private String loadBpmnResource(String resourcePath) {
        try {
            ClassPathResource resource = new ClassPathResource(resourcePath);
            return resource.getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("[WorkflowDataInitializer] BPMN resource not found: {}", resourcePath);
            return null;
        }
    }
}
