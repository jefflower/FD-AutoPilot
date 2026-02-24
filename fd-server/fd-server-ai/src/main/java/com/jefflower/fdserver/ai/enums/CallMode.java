package com.jefflower.fdserver.ai.enums;

/**
 * Agent 调用模式
 *
 * HTTP: 通过 HTTP 直接调用（需要 callUrl）
 * MQ: 通过消息队列间接调用（适合无互联网环境，客户端通过 task claim 消费）
 */
public enum CallMode {
    HTTP,
    MQ
}
