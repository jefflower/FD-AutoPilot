package com.jefflower.fdserver.ticket.config;

import com.jefflower.fdserver.ticket.repository.TicketRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ticket 模块数据初始化器
 * <p>
 * 启动时修复历史数据问题（如 @Version 字段为 NULL 导致的乐观锁异常）。
 * 使用 @Order(5) 确保在 AiDataInitializer(@Order(10)) 之前运行。
 */
@Component
@Order(5)
public class TicketDataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(TicketDataInitializer.class);

    private final TicketRepository ticketRepository;

    public TicketDataInitializer(TicketRepository ticketRepository) {
        this.ticketRepository = ticketRepository;
    }

    @Override
    @Transactional
    public void run(String... args) {
        fixNullVersions();
    }

    /**
     * 修复 Ticket 表中 version 为 NULL 的历史记录。
     * Hibernate @Version 乐观锁要求 version 非空，NULL 值会导致 NullPointerException。
     */
    private void fixNullVersions() {
        int updated = ticketRepository.fixNullVersions();
        if (updated > 0) {
            log.info("[TicketDataInitializer] Fixed {} tickets with NULL version", updated);
        } else {
            log.debug("[TicketDataInitializer] No tickets with NULL version found");
        }
    }
}
