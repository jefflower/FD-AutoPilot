package com.jefflower.fdserver.ticket.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.ticket.entity.KnowledgeBase;
import com.jefflower.fdserver.ticket.entity.KnowledgeSource;
import com.jefflower.fdserver.ticket.enums.KnowledgeSourceType;
import com.jefflower.fdserver.ticket.enums.KnowledgeSyncStatus;
import com.jefflower.fdserver.ticket.repository.KnowledgeBaseRepository;
import com.jefflower.fdserver.ticket.repository.KnowledgeSourceRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeSourceService {

    private final KnowledgeSourceRepository sourceRepository;
    private final KnowledgeBaseRepository baseRepository;

    @Value("${knowledge.storage.path:data/knowledge}")
    private String storagePath;

    @PostConstruct
    public void init() {
        try {
            Path dir = Paths.get(storagePath);
            if (!Files.exists(dir)) {
                Files.createDirectories(dir);
                log.info("[KnowledgeSource] 已创建存储目录: {}", dir.toAbsolutePath());
            }
        } catch (IOException e) {
            log.error("[KnowledgeSource] 创建存储目录失败: {}", storagePath, e);
        }
    }

    /**
     * 列出指定知识库下的所有源
     */
    public List<KnowledgeSource> listByBase(Long baseId) {
        return sourceRepository.findByKnowledgeBaseIdOrderByCreatedAtDesc(baseId);
    }

    /**
     * 上传文件作为知识库源
     */
    @Transactional
    public KnowledgeSource uploadFile(Long baseId, MultipartFile file) {
        KnowledgeBase base = baseRepository.findById(baseId)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_BASE_NOT_FOUND));

        String originalFileName = file.getOriginalFilename();
        if (originalFileName == null || originalFileName.isBlank()) {
            originalFileName = "unnamed";
        }

        // 确定源类型
        KnowledgeSourceType sourceType = detectSourceType(originalFileName);

        // 保存文件到 data/knowledge/{baseId}/
        String relativePath = saveFile(baseId, file, originalFileName);

        // 创建记录
        KnowledgeSource source = new KnowledgeSource();
        source.setKnowledgeBase(base);
        source.setTitle(originalFileName);
        source.setSourceType(sourceType);
        source.setFilePath(relativePath);
        source.setOriginalFileName(originalFileName);
        source.setFileSize(file.getSize());
        source.setSyncStatus(KnowledgeSyncStatus.NOT_SYNCED);

        KnowledgeSource saved = sourceRepository.save(source);
        log.info("[KnowledgeSource] 上传文件成功: baseId={}, sourceId={}, fileName={}",
                baseId, saved.getId(), originalFileName);
        return saved;
    }

    /**
     * 添加文本类型的知识库源
     */
    @Transactional
    public KnowledgeSource addText(Long baseId, String title, KnowledgeSourceType type, String content, String url) {
        KnowledgeBase base = baseRepository.findById(baseId)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_BASE_NOT_FOUND));

        KnowledgeSource source = new KnowledgeSource();
        source.setKnowledgeBase(base);
        source.setTitle(title);
        source.setSourceType(type);
        source.setContent(content);
        source.setUrl(url);
        source.setSyncStatus(KnowledgeSyncStatus.NOT_SYNCED);

        KnowledgeSource saved = sourceRepository.save(source);
        log.info("[KnowledgeSource] 添加文本源成功: baseId={}, sourceId={}, type={}", baseId, saved.getId(), type);
        return saved;
    }

    /**
     * 根据 ID 获取源
     */
    public KnowledgeSource getById(Long baseId, Long sourceId) {
        KnowledgeSource source = sourceRepository.findById(sourceId)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_SOURCE_NOT_FOUND));
        if (!source.getKnowledgeBase().getId().equals(baseId)) {
            throw new BusinessException(ErrorCode.KNOWLEDGE_SOURCE_NOT_FOUND);
        }
        return source;
    }

    /**
     * 更新源
     *
     * @param preserveSyncStatus 为 true 时保留当前同步状态（用于缓存从 NotebookLM 获取的 fulltext，
     *                           此时内容来自远端，无需重置同步状态）
     */
    @Transactional
    public KnowledgeSource update(Long sourceId, String title, String content, boolean preserveSyncStatus) {
        KnowledgeSource source = sourceRepository.findById(sourceId)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_SOURCE_NOT_FOUND));
        if (title != null) {
            source.setTitle(title);
        }
        if (content != null) {
            source.setContent(content);
        }
        if (!preserveSyncStatus) {
            // 用户主动编辑内容后重置同步状态
            source.setSyncStatus(KnowledgeSyncStatus.NOT_SYNCED);
        }
        return sourceRepository.save(source);
    }

    /**
     * 删除源（同时删除文件）
     */
    @Transactional
    public void delete(Long baseId, Long sourceId) {
        KnowledgeSource source = getById(baseId, sourceId);
        if (source.getFilePath() != null) {
            deleteFile(source.getFilePath());
        }
        sourceRepository.delete(source);
        log.info("[KnowledgeSource] 删除源成功: baseId={}, sourceId={}", baseId, sourceId);
    }

    /**
     * 获取同步状态统计
     */
    public Map<String, Object> getSyncStatus(Long baseId) {
        long total = sourceRepository.countByKnowledgeBaseId(baseId);
        long synced = sourceRepository.countByKnowledgeBaseIdAndSyncStatus(baseId, KnowledgeSyncStatus.SYNCED);
        long notSynced = sourceRepository.countByKnowledgeBaseIdAndSyncStatus(baseId, KnowledgeSyncStatus.NOT_SYNCED);
        long failed = sourceRepository.countByKnowledgeBaseIdAndSyncStatus(baseId, KnowledgeSyncStatus.FAILED);
        long syncing = sourceRepository.countByKnowledgeBaseIdAndSyncStatus(baseId, KnowledgeSyncStatus.SYNCING);

        Map<String, Object> status = new LinkedHashMap<>();
        status.put("total", total);
        status.put("synced", synced);
        status.put("notSynced", notSynced);
        status.put("syncing", syncing);
        status.put("failed", failed);
        return status;
    }

    // ===================== 同步方法 =====================

    /**
     * 更新源的同步状态（简化版，不再调用 CLI）
     */
    @Transactional
    public KnowledgeSource updateSyncStatus(Long sourceId, String notebookSourceId, KnowledgeSyncStatus status) {
        KnowledgeSource source = sourceRepository.findById(sourceId)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_SOURCE_NOT_FOUND));
        if (notebookSourceId != null) {
            source.setNotebookSourceId(notebookSourceId);
        }
        source.setSyncStatus(status);
        source.setSyncedAt(LocalDateTime.now());
        KnowledgeSource saved = sourceRepository.save(source);
        log.info("[KnowledgeSource] 更新同步状态: sourceId={}, status={}", sourceId, status);
        return saved;
    }

    /**
     * 保存从前端/客户端拉取的远程源数据（替代旧的 pullFromNotebookLm）
     *
     * @param baseId        知识库 ID
     * @param remoteSources 远程源列表，每项包含 source_id/id, title, type/source_type 等字段
     * @return 新创建的本地源记录列表
     */
    @Transactional
    public List<KnowledgeSource> savePulledSources(Long baseId, List<Map<String, Object>> remoteSources) {
        KnowledgeBase base = baseRepository.findById(baseId)
                .orElseThrow(() -> new BusinessException(ErrorCode.KNOWLEDGE_BASE_NOT_FOUND));

        List<KnowledgeSource> created = new ArrayList<>();

        for (Map<String, Object> remote : remoteSources) {
            String remoteSourceId = String.valueOf(remote.getOrDefault("source_id",
                    remote.getOrDefault("id", "")));
            if (remoteSourceId.isBlank()) {
                continue;
            }

            // 按 notebookSourceId 查本地：已存在则跳过
            Optional<KnowledgeSource> existing = sourceRepository
                    .findByKnowledgeBaseIdAndNotebookSourceId(baseId, remoteSourceId);
            if (existing.isPresent()) {
                continue;
            }

            // 创建本地记录
            KnowledgeSource source = new KnowledgeSource();
            source.setKnowledgeBase(base);
            source.setTitle(String.valueOf(remote.getOrDefault("title", "Untitled")));
            source.setSourceType(mapRemoteSourceType(remote));
            source.setNotebookSourceId(remoteSourceId);
            source.setSyncStatus(KnowledgeSyncStatus.SYNCED);
            source.setSyncedAt(LocalDateTime.now());

            KnowledgeSource saved = sourceRepository.save(source);
            created.add(saved);
        }

        log.info("[KnowledgeSource] 保存拉取的源完成: baseId={}, 新增={}条", baseId, created.size());
        return created;
    }

    /**
     * 同步单个源 — 简化为只更新状态
     */
    @Transactional
    public KnowledgeSource syncSource(Long baseId, Long sourceId) {
        KnowledgeSource source = getById(baseId, sourceId);

        // 设置为同步中
        source.setSyncStatus(KnowledgeSyncStatus.SYNCING);
        return sourceRepository.save(source);
    }

    /**
     * 同步所有未同步的源 — 标记为 SYNCING，实际同步由前端/客户端驱动
     */
    public List<KnowledgeSource> syncAll(Long baseId) {
        List<KnowledgeSource> notSynced = sourceRepository.findByKnowledgeBaseIdAndSyncStatus(
                baseId, KnowledgeSyncStatus.NOT_SYNCED);
        List<KnowledgeSource> failed = sourceRepository.findByKnowledgeBaseIdAndSyncStatus(
                baseId, KnowledgeSyncStatus.FAILED);

        List<KnowledgeSource> toSync = new ArrayList<>();
        toSync.addAll(notSynced);
        toSync.addAll(failed);

        List<KnowledgeSource> results = new ArrayList<>();
        for (KnowledgeSource source : toSync) {
            try {
                KnowledgeSource synced = syncSource(baseId, source.getId());
                results.add(synced);
            } catch (Exception e) {
                log.warn("[KnowledgeSource] 标记同步失败（跳过）: sourceId={}, error={}", source.getId(), e.getMessage());
            }
        }

        log.info("[KnowledgeSource] 批量标记同步完成: baseId={}, 成功={}/{}", baseId, results.size(), toSync.size());
        return results;
    }

    // ===================== 私有辅助方法 =====================

    private KnowledgeSourceType detectSourceType(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".pdf")) {
            return KnowledgeSourceType.PDF;
        } else if (lower.endsWith(".csv")) {
            return KnowledgeSourceType.CSV;
        } else if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
            return KnowledgeSourceType.MARKDOWN;
        } else {
            return KnowledgeSourceType.TEXT;
        }
    }

    private String saveFile(Long baseId, MultipartFile file, String originalFileName) {
        try {
            Path dir = Paths.get(storagePath, String.valueOf(baseId));
            if (!Files.exists(dir)) {
                Files.createDirectories(dir);
            }

            // 使用时间戳前缀避免文件名冲突
            String safeFileName = System.currentTimeMillis() + "_" + originalFileName.replaceAll("[^a-zA-Z0-9._\\-]", "_");
            Path filePath = dir.resolve(safeFileName);
            Files.copy(file.getInputStream(), filePath, StandardCopyOption.REPLACE_EXISTING);

            // 返回相对路径：{baseId}/{fileName}
            return baseId + "/" + safeFileName;
        } catch (IOException e) {
            throw new RuntimeException("文件保存失败: " + e.getMessage(), e);
        }
    }

    private void deleteFile(String relativePath) {
        try {
            Path path = Paths.get(storagePath).resolve(relativePath);
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("[KnowledgeSource] 删除文件失败: {}", relativePath, e);
        }
    }

    private KnowledgeSourceType mapRemoteSourceType(Map<String, Object> remote) {
        String type = String.valueOf(remote.getOrDefault("type",
                remote.getOrDefault("source_type", ""))).toUpperCase();
        // 去掉 "SOURCETYPE." 前缀（NotebookLM CLI 返回 "SourceType.PDF" 等格式）
        if (type.startsWith("SOURCETYPE.")) {
            type = type.substring("SOURCETYPE.".length());
        }
        return switch (type) {
            case "PDF" -> KnowledgeSourceType.PDF;
            case "CSV" -> KnowledgeSourceType.CSV;
            case "PASTED_TEXT", "TEXT" -> KnowledgeSourceType.TEXT;
            case "URL", "WEBSITE" -> KnowledgeSourceType.URL;
            case "MARKDOWN", "MD" -> KnowledgeSourceType.MARKDOWN;
            default -> KnowledgeSourceType.TEXT;
        };
    }
}
