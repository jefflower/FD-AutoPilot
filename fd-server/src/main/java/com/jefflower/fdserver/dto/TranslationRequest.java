package com.jefflower.fdserver.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class TranslationRequest {
    @NotBlank(message = "目标语言不能为空")
    private String targetLang;

    private String translatedTitle;

    private String translatedContent;
}
