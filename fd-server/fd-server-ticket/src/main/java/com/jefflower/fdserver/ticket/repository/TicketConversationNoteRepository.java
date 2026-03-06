package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.TicketConversationNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TicketConversationNoteRepository extends JpaRepository<TicketConversationNote, Long> {

    /**
     * 查询工单下所有标注（按创建时间正序）
     */
    List<TicketConversationNote> findByTicketIdOrderByCreatedAtAsc(Long ticketId);

    /**
     * 查询某条对话的所有标注
     */
    List<TicketConversationNote> findByTicketIdAndConversationIdOrderByCreatedAtAsc(Long ticketId, Long conversationId);

    /**
     * 查询某条对话的单条标注（一般一条对话只有一个标注）
     */
    Optional<TicketConversationNote> findByTicketIdAndConversationId(Long ticketId, Long conversationId);

    /**
     * 删除工单下所有标注
     */
    void deleteByTicketId(Long ticketId);
}
