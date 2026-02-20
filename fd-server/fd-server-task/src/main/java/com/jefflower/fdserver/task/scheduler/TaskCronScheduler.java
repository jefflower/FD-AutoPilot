package com.jefflower.fdserver.task.scheduler;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.enums.ExecutionMode;
import com.jefflower.fdserver.task.repository.TaskDefinitionRepository;
import com.jefflower.fdserver.task.service.TaskScheduleService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class TaskCronScheduler {

    private final TaskDefinitionRepository taskDefinitionRepository;
    private final TaskSchedulerRegistry taskSchedulerRegistry;
    private final TaskScheduleService taskScheduleService;

    /**
     * 启动时加载定时任务
     */
    @PostConstruct
    public void init() {
        log.info("Initializing TaskCronScheduler...");
        refreshSchedules();
    }

    /**
     * 每 5 分钟刷新配置
     */
    @Scheduled(fixedDelay = 300000)
    public void refreshSchedules() {
        List<TaskDefinition> scheduled = taskDefinitionRepository
                .findByExecutionMode(ExecutionMode.SERVER_SCHEDULED);
        taskSchedulerRegistry.updateSchedules(scheduled, taskScheduleService);
        log.debug("Refreshed {} scheduled task definitions", scheduled.size());
    }
}
