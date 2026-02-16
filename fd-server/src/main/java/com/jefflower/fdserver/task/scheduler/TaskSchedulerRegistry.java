package com.jefflower.fdserver.task.scheduler;

import com.jefflower.fdserver.task.entity.TaskDefinition;
import com.jefflower.fdserver.task.service.TaskScheduleService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.stream.Collectors;

@Slf4j
@Component
public class TaskSchedulerRegistry implements DisposableBean {

    private final TaskScheduler taskScheduler;
    private final Map<String, ScheduledFuture<?>> scheduledFutures = new ConcurrentHashMap<>();

    public TaskSchedulerRegistry(@Qualifier("taskModuleScheduler") TaskScheduler taskScheduler) {
        this.taskScheduler = taskScheduler;
    }

    /**
     * 更新 cron 调度：注册新的、取消禁用的
     */
    public void updateSchedules(List<TaskDefinition> definitions, TaskScheduleService service) {
        Set<String> activeCodes = definitions.stream()
                .filter(d -> d.isEnabled() && d.getCronExpression() != null && !d.getCronExpression().isBlank())
                .map(TaskDefinition::getCode)
                .collect(Collectors.toSet());

        // 取消不再活跃的
        scheduledFutures.entrySet().removeIf(entry -> {
            if (!activeCodes.contains(entry.getKey())) {
                entry.getValue().cancel(false);
                log.info("Cancelled scheduled task: {}", entry.getKey());
                return true;
            }
            return false;
        });

        // 注册新的
        for (TaskDefinition def : definitions) {
            if (!def.isEnabled() || def.getCronExpression() == null || def.getCronExpression().isBlank()) {
                continue;
            }
            if (scheduledFutures.containsKey(def.getCode())) {
                continue; // 已注册
            }

            try {
                CronTrigger trigger = new CronTrigger(def.getCronExpression());
                ScheduledFuture<?> future = taskScheduler.schedule(
                        () -> service.executeScheduledTask(def), trigger);
                scheduledFutures.put(def.getCode(), future);
                log.info("Registered scheduled task: code={}, cron={}", def.getCode(), def.getCronExpression());
            } catch (IllegalArgumentException e) {
                log.error("Invalid cron expression for task {}: {}", def.getCode(), def.getCronExpression(), e);
            }
        }
    }

    @Override
    public void destroy() {
        log.info("Destroying TaskSchedulerRegistry, cancelling {} scheduled tasks", scheduledFutures.size());
        scheduledFutures.values().forEach(f -> f.cancel(false));
        scheduledFutures.clear();
    }
}
