package com.jefflower.fdserver.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Schema(description = "回复提交请求")
@Data
public class ReplyRequest {
    @Schema(description = "中文回复内容")
    private String zhReply;

    @Schema(description = "目标语言回复内容（用于推送到 Freshdesk）")
    private String targetReply;
}
