package com.jefflower.fdserver.ai.scheduler;

import com.jefflower.fdserver.ai.repository.AgentInstanceRepository;
import com.jefflower.fdserver.ai.repository.ClientRegistrationRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * Periodic scheduler to mark offline clients and their agent instances.
 * Runs every 30 seconds, marks clients/instances as offline if heartbeat is older than 60s.
 */
@Component
@Slf4j
public class ClientHeartbeatScheduler {

    private final ClientRegistrationRepository clientRepo;
    private final AgentInstanceRepository instanceRepo;

    public ClientHeartbeatScheduler(ClientRegistrationRepository clientRepo,
                                     AgentInstanceRepository instanceRepo) {
        this.clientRepo = clientRepo;
        this.instanceRepo = instanceRepo;
    }

    @Scheduled(fixedDelay = 30000)
    @Transactional
    public void checkOfflineClients() {
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(60);
        LocalDateTime now = LocalDateTime.now();
        int offlineCount = clientRepo.markOfflineClients(cutoff, now);
        if (offlineCount > 0) {
            log.info("Marked {} clients as offline", offlineCount);
        }
    }
}
