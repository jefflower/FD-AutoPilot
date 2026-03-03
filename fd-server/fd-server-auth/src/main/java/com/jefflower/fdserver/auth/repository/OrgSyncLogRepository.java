package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.OrgSyncLog;
import com.jefflower.fdserver.auth.enums.OrgSyncStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface OrgSyncLogRepository extends JpaRepository<OrgSyncLog, Long> {
    List<OrgSyncLog> findTop20ByOrderByCreatedAtDesc();

    boolean existsByStatus(OrgSyncStatus status);
}
