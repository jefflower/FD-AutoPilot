package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.KnowledgeBase;
import com.jefflower.fdserver.ticket.entity.KnowledgeGroup;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionTarget;
import com.jefflower.fdserver.ticket.enums.KnowledgeVisibility;
import com.jefflower.fdserver.ticket.repository.KnowledgeBaseRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgeGroupRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgePermissionRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgeSourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeGroupService {

    private final KnowledgeGroupRepository groupRepository;
    private final KnowledgeBaseRepository baseRepository;
    private final KnowledgeSourceRepository sourceRepository;
    private final KnowledgePermissionRepository permissionRepository;

    /**
     * 列出所有知识主体
     */
    public List<KnowledgeGroup> listAll() {
        return groupRepository.findAllByOrderByCreatedAtDesc();
    }

    /**
     * 创建知识主体
     */
    @Transactional
    public KnowledgeGroup create(String name, String description, String color, Long createdBy) {
        KnowledgeGroup group = new KnowledgeGroup();
        group.setName(name);
        group.setDescription(description);
        group.setColor(color != null ? color : "amber");
        group.setCreatedBy(createdBy);

        KnowledgeGroup saved = groupRepository.save(group);
        log.info("[KnowledgeGroup] 创建主体: id={}, name={}", saved.getId(), saved.getName());
        return saved;
    }

    /**
     * 更新知识主体
     */
    @Transactional
    public KnowledgeGroup update(Long id, String name, String description, String color) {
        KnowledgeGroup group = getById(id);
        if (name != null) {
            group.setName(name);
        }
        if (description != null) {
            group.setDescription(description);
        }
        if (color != null) {
            group.setColor(color);
        }
        KnowledgeGroup saved = groupRepository.save(group);
        log.info("[KnowledgeGroup] 更新主体: id={}, name={}", saved.getId(), saved.getName());
        return saved;
    }

    /**
     * 删除知识主体（级联删除下属知识库、源和权限）
     */
    @Transactional
    public void delete(Long id) {
        KnowledgeGroup group = getById(id);

        // 删除下属知识库及其源
        List<KnowledgeBase> bases = baseRepository.findByGroupIdOrderByCreatedAtDesc(id);
        for (KnowledgeBase base : bases) {
            sourceRepository.deleteAllByKnowledgeBaseId(base.getId());
            // 删除知识库级别的权限
            permissionRepository.deleteByTargetTypeAndTargetId(KnowledgePermissionTarget.BASE, base.getId());
            baseRepository.delete(base);
        }

        // 删除主体级别的权限
        permissionRepository.deleteByTargetTypeAndTargetId(KnowledgePermissionTarget.GROUP, id);

        // 删除主体
        groupRepository.delete(group);
        log.info("[KnowledgeGroup] 已删除主体及关联数据: id={}, name={}", id, group.getName());
    }

    /**
     * 根据 ID 获取知识主体
     */
    public KnowledgeGroup getById(Long id) {
        return groupRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_GROUP_NOT_FOUND));
    }

    /**
     * 切换主体可见性
     */
    @Transactional
    public KnowledgeGroup toggleVisibility(Long id, KnowledgeVisibility visibility) {
        KnowledgeGroup group = getById(id);
        group.setVisibility(visibility);
        KnowledgeGroup saved = groupRepository.save(group);
        log.info("[KnowledgeGroup] 切换可见性: id={}, visibility={}", id, visibility);
        return saved;
    }
}
