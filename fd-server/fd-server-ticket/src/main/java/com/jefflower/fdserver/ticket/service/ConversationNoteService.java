package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.entity.TicketConversationNote;
import com.jefflower.fdserver.ticket.repository.TicketConversationNoteRepository;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * 对话标注服务
 * <p>
 * 管理工单对话上的标注（如视频审查结论、补充说明等）。
 * 每条 Freshdesk 对话最多一条标注（upsert 语义）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConversationNoteService {

    private final TicketConversationNoteRepository noteRepository;
    private final TicketRepository ticketRepository;

    /**
     * 查询工单下所有标注
     */
    public List<TicketConversationNote> listByTicketId(Long ticketId) {
        return noteRepository.findByTicketIdOrderByCreatedAtAsc(ticketId);
    }

    /**
     * 查询某条对话的标注
     */
    public Optional<TicketConversationNote> getByConversation(Long ticketId, Long conversationId) {
        return noteRepository.findByTicketIdAndConversationId(ticketId, conversationId);
    }

    /**
     * 创建或更新标注（每条对话最多一条标注，upsert 语义）
     */
    @Transactional
    public TicketConversationNote upsert(Long ticketId, Long conversationId,
                                          String noteContent, String noteType, String createdBy) {
        Ticket ticket = ticketRepository.findById(ticketId)
                .orElseThrow(() -> new BusinessException(ErrorCode.TICKET_NOT_FOUND, "工单不存在: " + ticketId));

        Optional<TicketConversationNote> existing =
                noteRepository.findByTicketIdAndConversationId(ticketId, conversationId);

        TicketConversationNote note;
        if (existing.isPresent()) {
            note = existing.get();
            note.setNoteContent(noteContent);
            if (noteType != null) {
                note.setNoteType(noteType);
            }
            log.info("[ConversationNote] Updated note for ticket={}, conversation={}", ticketId, conversationId);
        } else {
            note = new TicketConversationNote();
            note.setTicket(ticket);
            note.setConversationId(conversationId);
            note.setNoteContent(noteContent);
            note.setNoteType(noteType != null ? noteType : "GENERAL");
            note.setCreatedBy(createdBy);
            log.info("[ConversationNote] Created note for ticket={}, conversation={}", ticketId, conversationId);
        }

        return noteRepository.save(note);
    }

    /**
     * 删除标注
     */
    @Transactional
    public void delete(Long noteId) {
        if (!noteRepository.existsById(noteId)) {
            throw new BusinessException(ErrorCode.NOTE_NOT_FOUND, "标注不存在: " + noteId);
        }
        noteRepository.deleteById(noteId);
        log.info("[ConversationNote] Deleted note id={}", noteId);
    }

    /**
     * 按对话 ID 删除标注
     */
    @Transactional
    public void deleteByConversation(Long ticketId, Long conversationId) {
        Optional<TicketConversationNote> existing =
                noteRepository.findByTicketIdAndConversationId(ticketId, conversationId);
        existing.ifPresent(note -> {
            noteRepository.delete(note);
            log.info("[ConversationNote] Deleted note for ticket={}, conversation={}", ticketId, conversationId);
        });
    }

    /**
     * 将标注格式化为 Agent 可读的上下文文本
     * <p>
     * 格式示例:
     * <pre>
     * [Conversation #12345 Note (VIDEO_REVIEW)]: Customer's video shows product damage at 2:30 mark...
     * [Conversation #12346 Note (GENERAL)]: Customer confirmed delivery date was Jan 15
     * </pre>
     */
    public String formatAnnotationsForAgent(Long ticketId) {
        List<TicketConversationNote> notes = listByTicketId(ticketId);
        if (notes.isEmpty()) {
            return null;
        }

        StringBuilder sb = new StringBuilder();
        for (TicketConversationNote note : notes) {
            sb.append("[Conversation #").append(note.getConversationId())
              .append(" Note (").append(note.getNoteType()).append(")]: ")
              .append(note.getNoteContent())
              .append("\n");
        }
        return sb.toString().trim();
    }
}
