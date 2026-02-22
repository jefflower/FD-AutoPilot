package com.jefflower.fdserver.workflow.event;

import lombok.Getter;
import org.springframework.context.ApplicationEvent;

/**
 * 工作流状态变更事件 — 用于通知前端流程进度
 */
@Getter
public class WorkflowStatusEvent extends ApplicationEvent {

    private final String processInstanceId;
    private final String businessKey;
    private final String currentActivityId;
    private final String status; // "process-started", "node-completed", "process-completed"

    public WorkflowStatusEvent(Object source, String processInstanceId, String businessKey,
                               String currentActivityId, String status) {
        super(source);
        this.processInstanceId = processInstanceId;
        this.businessKey = businessKey;
        this.currentActivityId = currentActivityId;
        this.status = status;
    }
}
