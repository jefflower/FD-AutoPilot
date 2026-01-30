package com.jefflower.fdserver.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TicketContent {
    private String description;
    private List<ConversationDto> conversations;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ConversationDto {
        private Long id;
        private String bodyText;
        private Boolean isPrivate;
        private Boolean incoming;
        private Long userId;
        private String createdAt;
    }
}
