package com.jefflower.fdserver.ticket.dto;

import com.jefflower.fdserver.ticket.enums.AuditResult;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Schema(description = "审核提交请求")
@Data
public class AuditRequest {
    @Schema(description = "被审核的回复 ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "回复ID不能为空")
    private Long replyId;

    @Schema(description = "审核结果（PASS=通过, REJECT=驳回）", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "审核结果不能为空")
    private AuditResult auditResult;

    @Schema(description = "审核备注（驳回时建议填写原因）")
    private String auditRemark;
}
