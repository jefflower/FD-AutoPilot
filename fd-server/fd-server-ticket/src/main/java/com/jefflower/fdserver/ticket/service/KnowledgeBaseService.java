package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.KnowledgeBase;
import com.jefflower.fdserver.ticket.entity.KnowledgeGroup;
import com.jefflower.fdserver.ticket.entity.KnowledgeSource;
import com.jefflower.fdserver.ticket.enums.KnowledgeSyncStatus;
import com.jefflower.fdserver.ticket.repository.KnowledgeBaseRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgeGroupRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgeSourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeBaseService {

    private final KnowledgeBaseRepository knowledgeBaseRepository;
    private final KnowledgeSourceRepository knowledgeSourceRepository;
    private final KnowledgeGroupRepository knowledgeGroupRepository;

    @Value("${knowledge.storage.path:data/knowledge}")
    private String storagePath;

    /**
     * 列出所有知识库（填充 sourceCount/syncedCount）
     */
    public List<KnowledgeBase> listAll() {
        List<KnowledgeBase> bases = knowledgeBaseRepository.findAll();
        fillSourceCounts(bases);
        return bases;
    }

    /**
     * 按主体过滤知识库列表（填充 sourceCount/syncedCount）
     */
    public List<KnowledgeBase> listByGroupId(Long groupId) {
        List<KnowledgeBase> bases = knowledgeBaseRepository.findByGroupIdOrderByCreatedAtDesc(groupId);
        fillSourceCounts(bases);
        return bases;
    }

    /**
     * 创建知识库
     */
    @Transactional
    public KnowledgeBase create(String name, String description, String notebookId, String color,
                                 Long groupId, Long createdBy) {
        KnowledgeBase base = new KnowledgeBase();
        base.setName(name);
        base.setDescription(description);
        base.setNotebookId(notebookId);
        base.setColor(color != null ? color : "amber");
        base.setCreatedBy(createdBy);

        if (groupId != null) {
            KnowledgeGroup group = knowledgeGroupRepository.findById(groupId)
                    .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_GROUP_NOT_FOUND));
            base.setGroup(group);
        }

        return knowledgeBaseRepository.save(base);
    }

    /**
     * 创建知识库（兼容旧接口）
     */
    @Transactional
    public KnowledgeBase create(String name, String description, String notebookId, String color) {
        return create(name, description, notebookId, color, null, null);
    }

    /**
     * 根据 ID 获取知识库
     */
    public KnowledgeBase getById(Long id) {
        return knowledgeBaseRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_BASE_NOT_FOUND));
    }

    /**
     * 更新知识库
     */
    @Transactional
    public KnowledgeBase update(Long id, String name, String description, String notebookId, String color) {
        KnowledgeBase base = getById(id);
        if (name != null) {
            base.setName(name);
        }
        if (description != null) {
            base.setDescription(description);
        }
        if (notebookId != null) {
            base.setNotebookId(notebookId);
        }
        if (color != null) {
            base.setColor(color);
        }
        return knowledgeBaseRepository.save(base);
    }

    /**
     * 删除知识库（同时删除关联的源和文件）
     */
    @Transactional
    public void delete(Long id) {
        KnowledgeBase base = getById(id);

        // 删除关联的源文件
        List<KnowledgeSource> sources = knowledgeSourceRepository.findByKnowledgeBaseIdOrderByCreatedAtDesc(id);
        for (KnowledgeSource source : sources) {
            if (source.getFilePath() != null) {
                deleteFile(source.getFilePath());
            }
        }

        // 删除关联的源记录
        knowledgeSourceRepository.deleteAllByKnowledgeBaseId(id);

        // 删除知识库目录
        try {
            Path dir = Paths.get(storagePath, String.valueOf(id));
            if (Files.exists(dir)) {
                Files.walk(dir)
                        .sorted(java.util.Comparator.reverseOrder())
                        .forEach(path -> {
                            try {
                                Files.deleteIfExists(path);
                            } catch (IOException e) {
                                log.warn("[KnowledgeBase] 删除文件失败: {}", path, e);
                            }
                        });
            }
        } catch (IOException e) {
            log.warn("[KnowledgeBase] 删除知识库目录失败: baseId={}", id, e);
        }

        // 删除知识库记录
        knowledgeBaseRepository.delete(base);

        log.info("[KnowledgeBase] 已删除知识库及关联数据: id={}, name={}", id, base.getName());
    }

    /**
     * 填充 sourceCount 和 syncedCount
     */
    private void fillSourceCounts(List<KnowledgeBase> bases) {
        for (KnowledgeBase base : bases) {
            long count = knowledgeSourceRepository.countByKnowledgeBaseId(base.getId());
            long synced = knowledgeSourceRepository.countByKnowledgeBaseIdAndSyncStatus(
                    base.getId(), KnowledgeSyncStatus.SYNCED);
            base.setSourceCount(count);
            base.setSyncedCount(synced);
        }
    }

    private void deleteFile(String filePath) {
        try {
            Path path = Paths.get(storagePath).resolve(filePath);
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("[KnowledgeBase] 删除文件失败: {}", filePath, e);
        }
    }
}
