package com.jefflower.fdserver.ai.enums;

/**
 * Agent 调用模式
 *
 * HTTP: 通过 HTTP 直接调用（需要 callUrl）
 * MQ: 通过消息队列间接调用（适合无互联网环境，客户端通过 task claim 消费）
 * API: 通过服务端 REST API 直接调用（服务端内部执行，供 n8n 等外部编排器使用）
 */
public enum CallMode {
    HTTP,
    MQ,
    API
}
