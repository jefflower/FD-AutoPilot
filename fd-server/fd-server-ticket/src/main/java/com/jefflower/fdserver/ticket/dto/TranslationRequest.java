package com.jefflower.fdserver.ticket.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Schema(description = "翻译结果提交请求")
@Data
public class TranslationRequest {
    @Schema(description = "目标语言代码", example = "zh-CN", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "目标语言不能为空")
    private String targetLang;

    @Schema(description = "翻译后的标题")
    private String translatedTitle;

    @Schema(description = "翻译后的内容")
    private String translatedContent;
}
