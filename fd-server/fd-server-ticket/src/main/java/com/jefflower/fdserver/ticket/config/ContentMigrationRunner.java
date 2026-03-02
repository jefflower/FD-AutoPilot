package com.jefflower.fdserver.ticket.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jefflower.fdserver.ticket.entity.Ticket;
import com.jefflower.fdserver.ticket.repository.TicketRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 一次性数据迁移：将 ticket.subject 注入到 ticket.content JSON 中。
 * 迁移后 content JSON 结构为: {"subject":"...", "description":"...", "conversations":[...]}
 */
@Slf4j
@Component
@Order(20) // 在 AiDataInitializer(10) 之后执行
@RequiredArgsConstructor
public class ContentMigrationRunner implements CommandLineRunner {

    private final TicketRepository ticketRepository;
    private final ObjectMapper objectMapper;

    @Override
    @Transactional
    public void run(String... args) {
        List<Ticket> allTickets = ticketRepository.findAll();
        int migrated = 0;

        for (Ticket ticket : allTickets) {
            if (ticket.getContent() == null || ticket.getSubject() == null) continue;

            try {
                var node = objectMapper.readTree(ticket.getContent());
                if (node.isObject() && !node.has("subject")) {
                    ObjectNode obj = (ObjectNode) node;
                    obj.put("subject", ticket.getSubject());
                    ticket.setContent(objectMapper.writeValueAsString(obj));
                    ticketRepository.save(ticket);
                    migrated++;
                }
            } catch (Exception e) {
                log.warn("[ContentMigration] Failed to migrate ticket #{}: {}", ticket.getId(), e.getMessage());
            }
        }

        if (migrated > 0) {
            log.info("[ContentMigration] Migrated {} tickets: subject injected into content JSON", migrated);
        } else {
            log.info("[ContentMigration] No tickets need migration (all already have subject in content)");
        }
    }
}
