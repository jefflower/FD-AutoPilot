package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.enums.ExecutionMode;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class TicketTaskDefinitionInitializer {

    private final TaskDefinitionRepository taskDefinitionRepository;

    @PostConstruct
    public void init() {
        ensureDefinition("ticket.translate", "工单翻译", "通过 Gemini CLI 翻译工单内容",
                ExecutionMode.CLIENT_DISTRIBUTED, 300, 3, 5);
        ensureDefinition("ticket.reply", "工单回复", "通过 NotebookLM 生成工单回复",
                ExecutionMode.CLIENT_DISTRIBUTED, 600, 3, 1);
        ensureDefinition("ticket.audit", "工单审核", "人工审核工单回复",
                ExecutionMode.CLIENT_DISTRIBUTED, 3600, 1, 1);
    }

    private void ensureDefinition(String code, String name, String description,
                                   ExecutionMode mode, int timeoutSeconds,
                                   int maxRetries, int maxConcurrency) {
        if (taskDefinitionRepository.findByCode(code).isEmpty()) {
            TaskDefinition def = new TaskDefinition();
            def.setCode(code);
            def.setName(name);
            def.setDescription(description);
            def.setExecutionMode(mode);
            def.setTimeoutSeconds(timeoutSeconds);
            def.setMaxRetries(maxRetries);
            def.setMaxConcurrency(maxConcurrency);
            def.setEnabled(true);
            taskDefinitionRepository.save(def);
            log.info("初始化任务定义: {} ({})", code, name);
        }
    }
}
