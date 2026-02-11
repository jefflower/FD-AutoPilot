package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.KnowledgeNoteRequest;
import com.jefflower.fdserver.entity.KnowledgeNote;
import com.jefflower.fdserver.entity.Ticket;
import com.jefflower.fdserver.repository.KnowledgeNoteRepository;
import com.jefflower.fdserver.repository.TicketRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.HtmlUtils;

import java.util.List;

@Service
@RequiredArgsConstructor
public class KnowledgeService {

    private final KnowledgeNoteRepository noteRepository;
    private final TicketRepository ticketRepository;

    // ========== 注意事项 CRUD ==========

    public List<KnowledgeNote> getAllNotes() {
        return noteRepository.findAllByOrderBySortOrderAscIdAsc();
    }

    public KnowledgeNote getNoteById(Long id) {
        return noteRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("注意事项不存在: " + id));
    }

    @Transactional
    public KnowledgeNote createNote(KnowledgeNoteRequest request) {
        KnowledgeNote note = new KnowledgeNote();
        note.setTitle(sanitize(request.getTitle()));
        note.setContent(sanitize(request.getContent()));
        note.setSortOrder(request.getSortOrder() != null ? request.getSortOrder() : 0);
        return noteRepository.save(note);
    }

    @Transactional
    public KnowledgeNote updateNote(Long id, KnowledgeNoteRequest request) {
        KnowledgeNote note = getNoteById(id);
        note.setTitle(sanitize(request.getTitle()));
        note.setContent(sanitize(request.getContent()));
        if (request.getSortOrder() != null) {
            note.setSortOrder(request.getSortOrder());
        }
        return noteRepository.save(note);
    }

    /**
     * 对用户输入做 HTML 转义，防止存储型 XSS。
     */
    private String sanitize(String input) {
        if (input == null) {
            return null;
        }
        return HtmlUtils.htmlEscape(input);
    }

    @Transactional
    public void deleteNote(Long id) {
        noteRepository.deleteById(id);
    }

    // ========== 批量标记有效性 ==========

    @Transactional
    public int batchUpdateValidity(List<Long> ticketIds, Boolean isValid) {
        int count = 0;
        for (Long id : ticketIds) {
            if (ticketRepository.findById(id).map(ticket -> {
                ticket.setIsValid(isValid);
                ticketRepository.save(ticket);
                return true;
            }).orElse(false)) {
                count++;
            }
        }
        return count;
    }

    // ========== 导出有效工单 ==========

    public List<Ticket> getValidTickets() {
        return ticketRepository.findByFilters(
                null, null, null, true, null, null,
                PageRequest.of(0, 10000, Sort.by(Sort.Order.desc("updatedAt")))
        ).getContent();
    }
}
