package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.ticket.entity.KnowledgeBase;
import com.jefflower.fdserver.ticket.entity.KnowledgeGroup;
import com.jefflower.fdserver.ticket.entity.KnowledgePermission;
import com.jefflower.fdserver.ticket.entity.KnowledgeSource;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionLevel;
import com.jefflower.fdserver.ticket.enums.KnowledgePermissionTarget;
import com.jefflower.fdserver.ticket.enums.KnowledgeSourceType;
import com.jefflower.fdserver.ticket.enums.KnowledgeSyncStatus;
import com.jefflower.fdserver.ticket.enums.KnowledgeVisibility;
import com.jefflower.fdserver.ticket.service.KnowledgeBaseService;
import com.jefflower.fdserver.ticket.service.KnowledgeGroupService;
import com.jefflower.fdserver.ticket.service.KnowledgePermissionService;
import com.jefflower.fdserver.ticket.service.KnowledgeSourceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

@Tag(name = "知识库管理", description = "知识库 Group/Base/Source CRUD、权限管理、同步")
@RestController
@RequestMapping("/api/v1/knowledge-bases")
@RequiredArgsConstructor
public class KnowledgeBaseController {

    private final KnowledgeBaseService knowledgeBaseService;
    private final KnowledgeSourceService knowledgeSourceService;
    private final KnowledgeGroupService knowledgeGroupService;
    private final KnowledgePermissionService knowledgePermissionService;

    @Value("${knowledge.storage.path:data/knowledge}")
    private String storagePath;

    // ===================== 知识主体 (Group) CRUD =====================

    @Operation(summary = "列出所有知识主体")
    @GetMapping("/groups")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<List<KnowledgeGroup>>> listGroups() {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeGroupService.listAll()));
    }

    @Operation(summary = "创建知识主体")
    @PostMapping("/groups")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeGroup>> createGroup(@RequestBody Map<String, String> body) {
        String name = body.get("name");
        String description = body.get("description");
        String color = body.get("color");
        Long createdBy = body.containsKey("createdBy") ? Long.valueOf(body.get("createdBy")) : null;
        KnowledgeGroup created = knowledgeGroupService.create(name, description, color, createdBy);
        return ResponseEntity.ok(ApiResponse.ok("创建成功", created));
    }

    @Operation(summary = "更新知识主体")
    @PutMapping("/groups/{gid}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeGroup>> updateGroup(
            @Parameter(description = "主体 ID") @PathVariable Long gid,
            @RequestBody Map<String, String> body) {
        String name = body.get("name");
        String description = body.get("description");
        String color = body.get("color");
        KnowledgeGroup updated = knowledgeGroupService.update(gid, name, description, color);
        return ResponseEntity.ok(ApiResponse.ok("更新成功", updated));
    }

    @Operation(summary = "删除知识主体", description = "级联删除下属知识库、源和权限")
    @DeleteMapping("/groups/{gid}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Void>> deleteGroup(
            @Parameter(description = "主体 ID") @PathVariable Long gid) {
        knowledgeGroupService.delete(gid);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    @Operation(summary = "切换主体可见性")
    @PutMapping("/groups/{gid}/visibility")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeGroup>> toggleGroupVisibility(
            @Parameter(description = "主体 ID") @PathVariable Long gid,
            @RequestBody Map<String, String> body) {
        KnowledgeVisibility visibility = KnowledgeVisibility.valueOf(
                body.getOrDefault("visibility", "PUBLIC").toUpperCase());
        KnowledgeGroup updated = knowledgeGroupService.toggleVisibility(gid, visibility);
        return ResponseEntity.ok(ApiResponse.ok("更新成功", updated));
    }

    // ===================== 权限管理 =====================

    @Operation(summary = "获取主体的权限列表")
    @GetMapping("/groups/{gid}/permissions")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<List<KnowledgePermission>>> getGroupPermissions(
            @Parameter(description = "主体 ID") @PathVariable Long gid) {
        List<KnowledgePermission> permissions = knowledgePermissionService
                .getPermissions(KnowledgePermissionTarget.GROUP, gid);
        return ResponseEntity.ok(ApiResponse.ok(permissions));
    }

    @Operation(summary = "为主体添加权限")
    @PostMapping("/groups/{gid}/permissions")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgePermission>> addGroupPermission(
            @Parameter(description = "主体 ID") @PathVariable Long gid,
            @RequestBody Map<String, Object> body) {
        Long userId = Long.valueOf(String.valueOf(body.get("userId")));
        KnowledgePermissionLevel level = KnowledgePermissionLevel.valueOf(
                String.valueOf(body.getOrDefault("permission", "READ")).toUpperCase());
        KnowledgePermission perm = knowledgePermissionService
                .addPermission(KnowledgePermissionTarget.GROUP, gid, userId, level);
        return ResponseEntity.ok(ApiResponse.ok("添加成功", perm));
    }

    @Operation(summary = "移除主体权限")
    @DeleteMapping("/groups/{gid}/permissions/{pid}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Void>> removeGroupPermission(
            @Parameter(description = "主体 ID") @PathVariable Long gid,
            @Parameter(description = "权限 ID") @PathVariable Long pid) {
        knowledgePermissionService.removePermission(pid);
        return ResponseEntity.ok(ApiResponse.ok("移除成功", null));
    }

    // ===================== 知识库 CRUD =====================

    @Operation(summary = "列出所有知识库", description = "支持 groupId 参数过滤")
    @GetMapping
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<List<KnowledgeBase>>> listAll(
            @Parameter(description = "按主体过滤") @RequestParam(required = false) Long groupId) {
        if (groupId != null) {
            return ResponseEntity.ok(ApiResponse.ok(knowledgeBaseService.listByGroupId(groupId)));
        }
        return ResponseEntity.ok(ApiResponse.ok(knowledgeBaseService.listAll()));
    }

    @Operation(summary = "创建知识库")
    @PostMapping
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeBase>> create(@RequestBody Map<String, String> body) {
        String name = body.get("name");
        String description = body.get("description");
        String notebookId = body.get("notebookId");
        String color = body.get("color");
        Long groupId = body.containsKey("groupId") ? Long.valueOf(body.get("groupId")) : null;
        Long createdBy = body.containsKey("createdBy") ? Long.valueOf(body.get("createdBy")) : null;
        KnowledgeBase created = knowledgeBaseService.create(name, description, notebookId, color, groupId, createdBy);
        return ResponseEntity.ok(ApiResponse.ok("创建成功", created));
    }

    @Operation(summary = "获取知识库详情")
    @GetMapping("/{id}")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<KnowledgeBase>> getById(
            @Parameter(description = "知识库 ID") @PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeBaseService.getById(id)));
    }

    @Operation(summary = "更新知识库")
    @PutMapping("/{id}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeBase>> update(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        String name = body.get("name");
        String description = body.get("description");
        String notebookId = body.get("notebookId");
        String color = body.get("color");
        KnowledgeBase updated = knowledgeBaseService.update(id, name, description, notebookId, color);
        return ResponseEntity.ok(ApiResponse.ok("更新成功", updated));
    }

    @Operation(summary = "删除知识库", description = "同时删除关联的源和文件")
    @DeleteMapping("/{id}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Void>> delete(
            @Parameter(description = "知识库 ID") @PathVariable Long id) {
        knowledgeBaseService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    // ===================== 源管理 =====================

    @Operation(summary = "列出知识库下的所有源")
    @GetMapping("/{id}/sources")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<List<KnowledgeSource>>> listSources(
            @Parameter(description = "知识库 ID") @PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeSourceService.listByBase(id)));
    }

    @Operation(summary = "上传文件作为知识库源")
    @PostMapping("/{id}/sources/upload")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeSource>> uploadFile(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @RequestParam("file") MultipartFile file) {
        KnowledgeSource source = knowledgeSourceService.uploadFile(id, file);
        return ResponseEntity.ok(ApiResponse.ok("上传成功", source));
    }

    @Operation(summary = "添加文本类型的知识库源")
    @PostMapping("/{id}/sources/text")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeSource>> addText(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        String title = body.get("title");
        KnowledgeSourceType sourceType = KnowledgeSourceType.valueOf(
                body.getOrDefault("sourceType", "TEXT").toUpperCase());
        String content = body.get("content");
        String url = body.get("url");
        KnowledgeSource source = knowledgeSourceService.addText(id, title, sourceType, content, url);
        return ResponseEntity.ok(ApiResponse.ok("添加成功", source));
    }

    @Operation(summary = "获取知识库源详情")
    @GetMapping("/{id}/sources/{sid}")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<KnowledgeSource>> getSource(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @Parameter(description = "源 ID") @PathVariable Long sid) {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeSourceService.getById(id, sid)));
    }

    @Operation(summary = "更新知识库源")
    @PutMapping("/{id}/sources/{sid}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeSource>> updateSource(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @Parameter(description = "源 ID") @PathVariable Long sid,
            @RequestBody Map<String, String> body) {
        String title = body.get("title");
        String content = body.get("content");
        boolean preserveSyncStatus = "true".equalsIgnoreCase(body.get("preserveSyncStatus"));
        KnowledgeSource updated = knowledgeSourceService.update(sid, title, content, preserveSyncStatus);
        return ResponseEntity.ok(ApiResponse.ok("更新成功", updated));
    }

    @Operation(summary = "删除知识库源", description = "同时删除关联文件")
    @DeleteMapping("/{id}/sources/{sid}")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<Void>> deleteSource(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @Parameter(description = "源 ID") @PathVariable Long sid) {
        knowledgeSourceService.delete(id, sid);
        return ResponseEntity.ok(ApiResponse.ok("删除成功", null));
    }

    @Operation(summary = "下载/预览知识库源文件", description = "返回上传的原始文件（如 PDF），用于浏览器内嵌预览")
    @GetMapping("/{id}/sources/{sid}/file")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<Resource> downloadSourceFile(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @Parameter(description = "源 ID") @PathVariable Long sid) {
        KnowledgeSource source = knowledgeSourceService.getById(id, sid);
        if (source.getFilePath() == null || source.getFilePath().isBlank()) {
            return ResponseEntity.notFound().build();
        }

        try {
            Path filePath = Paths.get(storagePath).resolve(source.getFilePath());
            if (!Files.exists(filePath)) {
                return ResponseEntity.notFound().build();
            }

            Resource resource = new UrlResource(filePath.toUri());
            String contentType = Files.probeContentType(filePath);
            if (contentType == null) {
                contentType = "application/octet-stream";
            }

            String fileName = source.getOriginalFileName() != null
                    ? source.getOriginalFileName()
                    : filePath.getFileName().toString();
            String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "inline; filename*=UTF-8''" + encodedFileName)
                    .body(resource);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    // ===================== 同步 =====================

    @Operation(summary = "标记所有未同步的源为同步中")
    @PostMapping("/{id}/sync")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<List<KnowledgeSource>>> syncAll(
            @Parameter(description = "知识库 ID") @PathVariable Long id) {
        List<KnowledgeSource> synced = knowledgeSourceService.syncAll(id);
        return ResponseEntity.ok(ApiResponse.ok("同步标记完成", synced));
    }

    @Operation(summary = "标记单个源为同步中")
    @PostMapping("/{id}/sources/{sid}/sync")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeSource>> syncSource(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @Parameter(description = "源 ID") @PathVariable Long sid) {
        KnowledgeSource synced = knowledgeSourceService.syncSource(id, sid);
        return ResponseEntity.ok(ApiResponse.ok("同步标记成功", synced));
    }

    @Operation(summary = "更新源的同步状态", description = "由前端/客户端完成同步后回调更新状态")
    @PutMapping("/{id}/sources/{sid}/sync-status")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<KnowledgeSource>> updateSyncStatus(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @Parameter(description = "源 ID") @PathVariable Long sid,
            @RequestBody Map<String, String> body) {
        String notebookSourceId = body.get("notebookSourceId");
        KnowledgeSyncStatus status = KnowledgeSyncStatus.valueOf(
                body.getOrDefault("status", "SYNCED").toUpperCase());
        KnowledgeSource updated = knowledgeSourceService.updateSyncStatus(sid, notebookSourceId, status);
        return ResponseEntity.ok(ApiResponse.ok("状态更新成功", updated));
    }

    @Operation(summary = "保存从远程拉取的源数据", description = "替代旧的 pullFromNotebookLm，接受前端传来的远程源数据")
    @PostMapping("/{id}/pull")
    @RequiresPermission("knowledge:manage")
    public ResponseEntity<ApiResponse<List<KnowledgeSource>>> savePulledSources(
            @Parameter(description = "知识库 ID") @PathVariable Long id,
            @RequestBody List<Map<String, Object>> remoteSources) {
        List<KnowledgeSource> pulled = knowledgeSourceService.savePulledSources(id, remoteSources);
        return ResponseEntity.ok(ApiResponse.ok("拉取保存完成", pulled));
    }

    @Operation(summary = "获取同步状态统计")
    @GetMapping("/{id}/sync-status")
    @RequiresPermission("knowledge:read")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getSyncStatus(
            @Parameter(description = "知识库 ID") @PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(knowledgeSourceService.getSyncStatus(id)));
    }
}
