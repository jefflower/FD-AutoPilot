package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.KnowledgePermission;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionLevel;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionTarget;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface KnowledgePermissionRepository extends JpaRepository<KnowledgePermission, Long> {

    List<KnowledgePermission> findByTargetTypeAndTargetId(KnowledgePermissionTarget targetType, Long targetId);

    Optional<KnowledgePermission> findByTargetTypeAndTargetIdAndUserId(
            KnowledgePermissionTarget targetType, Long targetId, Long userId);

    void deleteByTargetTypeAndTargetId(KnowledgePermissionTarget targetType, Long targetId);

    boolean existsByTargetTypeAndTargetIdAndUserIdAndPermission(
            KnowledgePermissionTarget targetType, Long targetId, Long userId, KnowledgePermissionLevel permission);
}
