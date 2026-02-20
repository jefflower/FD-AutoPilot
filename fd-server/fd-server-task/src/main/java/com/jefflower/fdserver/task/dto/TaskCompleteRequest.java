package com.jefflower.fdserver.task.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Schema(description = "任务完成请求")
@Data
public class TaskCompleteRequest {
    @Schema(description = "客户端唯一标识", requiredMode = Schema.RequiredMode.REQUIRED)
    private String clientId;

    @Schema(description = "任务是否成功完成")
    private boolean success;

    @Schema(description = "完成消息（成功时为结果摘要，失败时为错误信息）")
    private String message;
}
