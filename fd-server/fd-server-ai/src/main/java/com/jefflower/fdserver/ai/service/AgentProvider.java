package com.jefflower.fdserver.ai.service;

import com.jefflower.fdserver.ai.dto.AgentExecuteResult;
import com.jefflower.fdserver.ai.enums.ProviderType;

import java.util.Map;

/**
 * Agent Provider SPI
 *
 * 服务端可执行的 Agent Provider 接口。
 * 按 ProviderType 注册，每个 ProviderType 一个实现类。
 * 实现类通过 Spring @Component 自动注册。
 */
public interface AgentProvider {

    ProviderType getProviderType();

    AgentExecuteResult execute(String input, Map<String, Object> config);
}
