package com.jefflower.fdserver.auth.controller;

import com.jefflower.fdserver.auth.entity.SysApplication;
import com.jefflower.fdserver.auth.repository.SysApplicationRepository;
import com.jefflower.fdserver.auth.security.RequiresPermission;
import com.jefflower.fdserver.common.dto.ApiResponse;
import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 应用管理 Controller。
 * <p>
 * 提供系统应用的 CRUD 接口，内置应用不可删除。
 */
@Tag(name = "应用管理", description = "系统应用的 CRUD 管理，内置应用不可删除")
@RestController
@RequestMapping("/api/v1/auth/applications")
@RequiredArgsConstructor
public class ApplicationController {

    private final SysApplicationRepository applicationRepository;

    /**
     * 获取所有应用列表
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<SysApplication>>> getAllApplications() {
        return ResponseEntity.ok(ApiResponse.ok(applicationRepository.findAll()));
    }

    /**
     * 创建应用（需要 role:manage 权限）
     */
    @PostMapping
    @RequiresPermission("role:manage")
    public ResponseEntity<ApiResponse<SysApplication>> createApplication(@RequestBody SysApplication application) {
        if (application.getCode() == null || application.getCode().isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "应用 code 不能为空");
        }
        if (application.getName() == null || application.getName().isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "应用名称不能为空");
        }
        if (applicationRepository.existsByCode(application.getCode())) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "应用 code 已存在: " + application.getCode());
        }

        // 新建应用不允许设为内置
        application.setBuiltIn(false);
        application.setId(null);

        SysApplication saved = applicationRepository.save(application);
        return ResponseEntity.ok(ApiResponse.ok("应用创建成功", saved));
    }

    /**
     * 更新应用（需要 role:manage 权限）
     */
    @PutMapping("/{id}")
    @RequiresPermission("role:manage")
    public ResponseEntity<ApiResponse<SysApplication>> updateApplication(
            @PathVariable Long id,
            @RequestBody SysApplication application) {
        SysApplication existing = applicationRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_PARAMETER, "应用不存在"));

        // 不允许修改 code 和 builtIn 属性
        if (application.getName() != null && !application.getName().isBlank()) {
            existing.setName(application.getName());
        }
        if (application.getDescription() != null) {
            existing.setDescription(application.getDescription());
        }
        existing.setEnabled(application.isEnabled());

        SysApplication saved = applicationRepository.save(existing);
        return ResponseEntity.ok(ApiResponse.ok("应用更新成功", saved));
    }

    /**
     * 删除应用（需要 role:manage 权限，内置应用不可删除）
     */
    @DeleteMapping("/{id}")
    @RequiresPermission("role:manage")
    public ResponseEntity<ApiResponse<Void>> deleteApplication(@PathVariable Long id) {
        SysApplication existing = applicationRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.INVALID_PARAMETER, "应用不存在"));

        if (existing.isBuiltIn()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMETER, "内置应用不可删除");
        }

        applicationRepository.deleteById(id);
        return ResponseEntity.ok(ApiResponse.ok("应用删除成功", null));
    }
}
