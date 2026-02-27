package com.jefflower.fdserver.common.exception;

import lombok.Getter;

@Getter
public enum ErrorCode {
    // Auth
    USER_NOT_FOUND(404, "用户不存在"),
    WRONG_PASSWORD(401, "密码错误"),
    USER_NOT_APPROVED(403, "用户尚未审核通过"),
    USER_REJECTED(403, "用户已被拒绝"),
    USERNAME_EXISTS(409, "用户名已存在"),
    INVALID_PASSWORD(400, "密码不符合要求"),
    ROLE_NOT_FOUND(404, "角色不存在"),
    PERMISSION_NOT_FOUND(404, "权限不存在"),
    MODULE_NOT_FOUND(404, "模块不存在"),
    MODULE_BUILTIN_READONLY(403, "内置模块不允许修改"),
    ADMIN_ALREADY_EXISTS(409, "管理员已存在"),
    INVALID_REFRESH_TOKEN(401, "Refresh Token 无效或已过期"),

    // Ticket
    TICKET_NOT_FOUND(404, "工单不存在"),
    INVALID_STATUS_TRANSITION(400, "工单状态不允许此操作"),
    REPLY_NOT_FOUND(404, "回复不存在"),
    REPLY_NOT_BELONG_TO_TICKET(400, "回复不属于此工单"),
    SELECTED_REPLY_NOT_FOUND(404, "未找到已选中的回复"),
    TRANSLATION_NOT_FOUND(404, "翻译不存在"),
    TRANSLATION_REQUIRED(400, "工单尚未完成翻译"),
    TRANSLATION_INCOMPLETE(400, "翻译内容不完整"),
    REPLY_REQUIRED(400, "工单尚未完成回复，无法通过审核"),
    SYNC_FAILED(500, "同步失败"),

    // Task
    TASK_NOT_FOUND(404, "任务不存在"),
    TASK_ALREADY_CLAIMED(409, "任务已被领取"),
    TASK_NOT_OWNED(403, "不是任务的持有者"),

    // AuditToken
    AUDIT_TOKEN_NOT_FOUND(404, "审核Token不存在"),
    AUDIT_TOKEN_EXPIRED(400, "审核Token已过期"),
    AUDIT_TOKEN_INVALID(400, "审核Token已失效"),

    // OAuth & OrgSync
    OAUTH_DISABLED(403, "OAuth 登录未启用"),
    OAUTH_FAILED(500, "OAuth 认证失败"),
    OAUTH_USER_NOT_FOUND(404, "OAuth 用户未找到且未开启自动创建"),
    ORG_SYNC_FAILED(500, "组织架构同步失败"),
    ORG_SYNC_PLATFORM_NOT_CONFIGURED(400, "同步平台未配置"),
    ORG_SYNC_IN_PROGRESS(409, "同步正在进行中"),

    // General
    INVALID_PARAMETER(400, "参数错误"),
    UNAUTHORIZED(401, "未授权"),
    FORBIDDEN(403, "无权限"),
    INTERNAL_ERROR(500, "服务器内部错误"),
    SUPER_PASSWORD_WRONG(403, "超级密码错误"),

    // AI
    AGENT_NOT_FOUND(404, "Agent 不存在"),
    AGENT_NOT_AVAILABLE(400, "Agent 不可用"),
    AGENT_EXECUTION_FAILED(500, "Agent 执行失败"),
    AGENT_PROVIDER_NOT_FOUND(500, "Agent Provider 未找到"),

    // Workflow
    WORKFLOW_NOT_FOUND(404, "工作流定义不存在"),
    WORKFLOW_ALREADY_EXISTS(409, "工作流定义已存在"),
    WORKFLOW_DEPLOY_FAILED(500, "工作流部署失败"),
    WORKFLOW_INSTANCE_NOT_FOUND(404, "工作流实例不存在"),
    WORKFLOW_SIGNAL_FAILED(500, "工作流信号发送失败"),

    // Config
    CONFIG_NOT_FOUND(404, "配置不存在");

    private final int httpStatus;
    private final String message;

    ErrorCode(int httpStatus, String message) {
        this.httpStatus = httpStatus;
        this.message = message;
    }
}
