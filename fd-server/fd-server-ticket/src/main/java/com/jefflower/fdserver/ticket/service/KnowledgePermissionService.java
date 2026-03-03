package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.KnowledgeGroup;
import com.jefflower.fdserver.ticket.entity.KnowledgeBase;
import com.jefflower.fdserver.ticket.entity.KnowledgePermission;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionLevel;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionTarget;
import com.jefflower.fdserver.ticket.enums.KnowledgeVisibility;
import com.jefflower.fdserver.ticket.repository.KnowledgeBaseRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgeGroupRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgePermissionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgePermissionService {

    private final KnowledgePermissionRepository permissionRepository;
    private final KnowledgeGroupRepository groupRepository;
    private final KnowledgeBaseRepository baseRepository;

    /**
     * 获取权限列表
     */
    public List<KnowledgePermission> getPermissions(KnowledgePermissionTarget targetType, Long targetId) {
        return permissionRepository.findByTargetTypeAndTargetId(targetType, targetId);
    }

    /**
     * 添加权限
     */
    @Transactional
    public KnowledgePermission addPermission(KnowledgePermissionTarget targetType, Long targetId,
                                              Long userId, KnowledgePermissionLevel level) {
        // 检查是否已存在相同权限
        Optional<KnowledgePermission> existing = permissionRepository
                .findByTargetTypeAndTargetIdAndUserId(targetType, targetId, userId);

        if (existing.isPresent()) {
            // 更新已有权限级别
            KnowledgePermission perm = existing.get();
            perm.setPermission(level);
            KnowledgePermission saved = permissionRepository.save(perm);
            log.info("[KnowledgePermission] 更新权限: targetType={}, targetId={}, userId={}, level={}",
                    targetType, targetId, userId, level);
            return saved;
        }

        KnowledgePermission perm = new KnowledgePermission();
        perm.setTargetType(targetType);
        perm.setTargetId(targetId);
        perm.setUserId(userId);
        perm.setPermission(level);

        KnowledgePermission saved = permissionRepository.save(perm);
        log.info("[KnowledgePermission] 添加权限: targetType={}, targetId={}, userId={}, level={}",
                targetType, targetId, userId, level);
        return saved;
    }

    /**
     * 移除权限
     */
    @Transactional
    public void removePermission(Long permissionId) {
        if (!permissionRepository.existsById(permissionId)) {
            throw new BusinessException(ErrorCode.KNOWLEDGE_PERMISSION_DENIED, "权限记录不存在");
        }
        permissionRepository.deleteById(permissionId);
        log.info("[KnowledgePermission] 移除权限: permissionId={}", permissionId);
    }

    /**
     * 检查用户是否有指定权限
     *
     * 权限规则:
     * - PUBLIC 资源: 所有用户有 WRITE 权限
     * - PRIVATE 资源: 检查 KnowledgePermission 表
     * - ADMIN 级别包含 WRITE，WRITE 包含 READ
     */
    public boolean hasPermission(KnowledgePermissionTarget targetType, Long targetId,
                                  Long userId, KnowledgePermissionLevel requiredLevel) {
        // 获取资源的可见性
        KnowledgeVisibility visibility = getVisibility(targetType, targetId);

        // PUBLIC 资源：所有用户有 WRITE 及以下权限
        if (visibility == KnowledgeVisibility.PUBLIC) {
            if (requiredLevel == KnowledgePermissionLevel.READ
                    || requiredLevel == KnowledgePermissionLevel.WRITE) {
                return true;
            }
            // PUBLIC 资源的 ADMIN 权限仍需检查权限表
        }

        // PRIVATE 资源或 PUBLIC 的 ADMIN 级别：查权限表
        // 检查是否有直接权限或更高级别权限
        if (requiredLevel == KnowledgePermissionLevel.READ) {
            // READ: 拥有 READ, WRITE 或 ADMIN 任一即可
            return permissionRepository.existsByTargetTypeAndTargetIdAndUserIdAndPermission(
                    targetType, targetId, userId, KnowledgePermissionLevel.READ)
                    || permissionRepository.existsByTargetTypeAndTargetIdAndUserIdAndPermission(
                    targetType, targetId, userId, KnowledgePermissionLevel.WRITE)
                    || permissionRepository.existsByTargetTypeAndTargetIdAndUserIdAndPermission(
                    targetType, targetId, userId, KnowledgePermissionLevel.ADMIN);
        }

        if (requiredLevel == KnowledgePermissionLevel.WRITE) {
            // WRITE: 拥有 WRITE 或 ADMIN 即可
            return permissionRepository.existsByTargetTypeAndTargetIdAndUserIdAndPermission(
                    targetType, targetId, userId, KnowledgePermissionLevel.WRITE)
                    || permissionRepository.existsByTargetTypeAndTargetIdAndUserIdAndPermission(
                    targetType, targetId, userId, KnowledgePermissionLevel.ADMIN);
        }

        if (requiredLevel == KnowledgePermissionLevel.ADMIN) {
            // ADMIN: 只有 ADMIN 权限才行
            return permissionRepository.existsByTargetTypeAndTargetIdAndUserIdAndPermission(
                    targetType, targetId, userId, KnowledgePermissionLevel.ADMIN);
        }

        return false;
    }

    /**
     * 获取资源的可见性
     */
    private KnowledgeVisibility getVisibility(KnowledgePermissionTarget targetType, Long targetId) {
        if (targetType == KnowledgePermissionTarget.GROUP) {
            return groupRepository.findById(targetId)
                    .map(KnowledgeGroup::getVisibility)
                    .orElse(KnowledgeVisibility.PRIVATE);
        } else if (targetType == KnowledgePermissionTarget.BASE) {
            return baseRepository.findById(targetId)
                    .map(KnowledgeBase::getVisibility)
                    .orElse(KnowledgeVisibility.PRIVATE);
        }
        return KnowledgeVisibility.PRIVATE;
    }
}
