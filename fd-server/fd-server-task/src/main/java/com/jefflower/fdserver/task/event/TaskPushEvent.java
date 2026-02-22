package com.jefflower.fdserver.task.event;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;

import java.util.Map;

/**
 * 新任务创建事件 — 用于通知 SSE 推送给客户端
 */
@Getter
public class TaskPushEvent extends ApplicationEvent {

    private final String taskType;
    private final Long taskInstanceId;
    private final String referenceType;
    private final Long referenceId;
    private final Map<String, Object> metadata;

    public TaskPushEvent(Object source, String taskType, Long taskInstanceId,
                         String referenceType, Long referenceId,
                         Map<String, Object> metadata) {
        super(source);
        this.taskType = taskType;
        this.taskInstanceId = taskInstanceId;
        this.referenceType = referenceType;
        this.referenceId = referenceId;
        this.metadata = metadata;
    }
}
