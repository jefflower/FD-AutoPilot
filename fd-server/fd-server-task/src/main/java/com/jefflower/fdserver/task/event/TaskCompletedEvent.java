package com.jefflower.fdserver.task.event;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;

/**
 * 任务完成事件 — 通知客户端任务已完成
 */
@Getter
public class TaskCompletedEvent extends ApplicationEvent {

    private final Long taskInstanceId;
    private final String taskType;
    private final boolean success;
    private final String clientId;

    public TaskCompletedEvent(Object source, Long taskInstanceId, String taskType,
                              boolean success, String clientId) {
        super(source);
        this.taskInstanceId = taskInstanceId;
        this.taskType = taskType;
        this.success = success;
        this.clientId = clientId;
    }
}
