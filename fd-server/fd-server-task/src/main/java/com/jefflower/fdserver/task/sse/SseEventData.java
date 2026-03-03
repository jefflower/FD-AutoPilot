package com.jefflower.fdserver.task.sse;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * SSE 推送事件的数据载体
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SseEventData {

    private String eventType;
    private Object data;
}
