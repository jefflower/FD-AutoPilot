package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.entity.SyncLog;
import com.jefflower.fdserver.enums.SyncStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface SyncLogRepository extends JpaRepository<SyncLog, Long> {
    Page<SyncLog> findAllByOrderByStartTimeDesc(Pageable pageable);

    Optional<SyncLog> findFirstByStatusOrderByStartTimeDesc(SyncStatus status);
}
