package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.entity.TicketConversationNote;
import com.jefflower.fdserver.ticket.service.ConversationNoteService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 对话标注 CRUD 接口
 * <p>
 * 每条 Freshdesk 对话最多一条标注（upsert 语义）。
 * 路径嵌套在 /api/v1/tickets/{ticketId}/notes 下。
 */
@Tag(name = "对话标注", description = "工单对话标注管理（视频审查结论、补充说明等）")
@Slf4j
@RestController
@RequestMapping("/api/v1/tickets/{ticketId}/notes")
@RequiredArgsConstructor
public class ConversationNoteController {

    private final ConversationNoteService noteService;

    /**
     * 查询工单下所有标注
     */
    @Operation(summary = "查询标注列表", description = "获取指定工单的所有对话标注")
    @GetMapping
    @RequiresPermission("ticket:read")
    public ResponseEntity<ApiResponse<List<TicketConversationNote>>> list(
            @PathVariable Long ticketId) {
        List<TicketConversationNote> notes = noteService.listByTicketId(ticketId);
        return ResponseEntity.ok(ApiResponse.ok(notes));
    }

    /**
     * 创建或更新标注（upsert）
     */
    @Operation(summary = "创建/更新标注", description = "对指定对话添加或更新标注，每条对话最多一条标注")
    @PutMapping("/{conversationId}")
    @RequiresPermission("ticket:write")
    public ResponseEntity<ApiResponse<TicketConversationNote>> upsert(
            @PathVariable Long ticketId,
            @PathVariable Long conversationId,
            @RequestBody Map<String, String> body,
            Authentication authentication) {
        String noteContent = body.get("noteContent");
        String noteType = body.getOrDefault("noteType", "GENERAL");
        String username = authentication != null ? authentication.getName() : "anonymous";

        TicketConversationNote note = noteService.upsert(ticketId, conversationId,
                noteContent, noteType, username);
        return ResponseEntity.ok(ApiResponse.ok(note));
    }

    /**
     * 删除对话标注
     */
    @Operation(summary = "删除标注", description = "删除指定对话上的标注")
    @DeleteMapping("/{conversationId}")
    @RequiresPermission("ticket:write")
    public ResponseEntity<ApiResponse<Void>> delete(
            @PathVariable Long ticketId,
            @PathVariable Long conversationId) {
        noteService.deleteByConversation(ticketId, conversationId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
