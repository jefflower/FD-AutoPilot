import type { SkillInfo } from '../../../tauri/bridge';
import type { AgentExecutor } from './types';
import type { AgentDefinition, AgentExecuteInput, AgentExecuteResult, AgentStreamChunk } from '../../types/server';
import { parseAgentConfig } from '../schemaUtils';
import { AgentRegistry } from '../AgentRegistry';

/** LLM API 执行器默认值 */
const DEFAULTS = {
    model: 'deepseek-chat',
    maxTokens: 4096,
    temperature: 0.7,
};

/**
 * LLM API 执行器
 *
 * 通过 OpenAI 兼容格式直接调用各种 LLM API（DeepSeek、Qwen、硅基流动、Ollama 等）。
 * 不绑定单一 capability code，通过 providerType=LLM_API 路由。
 * 用户可创建多个 LLM_API 类型的 Capability（如 deepseek-api、qwen-api），
 * 每个 Capability 在 Agent 的 agentConfig 中配置 baseUrl/apiKey/model。
 */
export class LlmApiExecutor implements AgentExecutor {
    readonly providerType = 'LLM_API' as const;
    // 不设 supportedCapability，通过 providerType 回退路由匹配所有 LLM_API 类型的 Capability

    isAvailable(): boolean {
        return true; // HTTP API 调用无需本地环境检测
    }

    async getAvailableModels(): Promise<string[]> {
        // LLM_API 的模型列表在每个 Capability 的 agentConfig 中配置，无法全局探测
        return [];
    }

    async detectSkills(): Promise<SkillInfo[]> {
        return [];
    }

    /** 从 Capability 的 detectConfig 读取 API 配置（baseUrl/apiKey/model） */
    private getCapabilityConfig(definition: AgentDefinition): Record<string, any> {
        if (!definition.requiredCapability) {
            console.warn(`[LlmApiExecutor] Agent "${definition.code}" 没有 requiredCapability`);
            return {};
        }
        try {
            const registry = AgentRegistry.getInstance();
            const cap = registry.getCapabilityByCode(definition.requiredCapability);
            console.log(`[LlmApiExecutor] Agent "${definition.code}" requiredCapability="${definition.requiredCapability}", cap found=${!!cap}, detectConfig=${cap?.detectConfig?.substring(0, 100)}`);
            if (cap?.detectConfig) {
                const parsed = JSON.parse(cap.detectConfig);
                console.log(`[LlmApiExecutor] Parsed capConfig keys: ${Object.keys(parsed).join(', ')}`);
                return parsed;
            }
            // 所有已加载的 capabilities
            const allCaps = registry.getCapabilities();
            console.warn(`[LlmApiExecutor] Capability "${definition.requiredCapability}" detectConfig 为空。已加载 ${allCaps.length} 个 capabilities: ${allCaps.map(c => c.code).join(', ')}`);
        } catch (e) {
            console.error(`[LlmApiExecutor] getCapabilityConfig 出错:`, e);
        }
        return {};
    }

    /** 过滤掉空值（空字符串、null、undefined），避免覆盖上层配置 */
    private filterEmpty(obj: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj)) {
            if (v !== null && v !== undefined && v !== '') result[k] = v;
        }
        return result;
    }

    async execute(definition: AgentDefinition, input: AgentExecuteInput): Promise<AgentExecuteResult> {
        // 四级合并：DEFAULTS < capabilityConfig < agentConfig < input.params（过滤空值）
        const capConfig = this.getCapabilityConfig(definition);
        const agentConfig = this.filterEmpty(parseAgentConfig(definition.agentConfig));
        const mergedParams = this.filterEmpty(input.params || {});
        const config: Record<string, any> = { ...DEFAULTS, ...capConfig, ...agentConfig, ...mergedParams };
        const startTime = Date.now();

        try {
            const { baseUrl, apiKey, model, maxTokens, temperature } = config;

            if (!baseUrl) {
                throw new Error(`Agent "${definition.code}" 缺少 baseUrl 配置，请在 agentConfig 中设置 LLM API 地址`);
            }
            if (!apiKey) {
                throw new Error(`Agent "${definition.code}" 缺少 apiKey 配置，请在 agentConfig 中设置 API 密钥`);
            }

            // 服务端已解析的最终提示词
            const prompt = config.resolvedPrompt;
            if (!prompt) {
                throw new Error(`Agent "${definition.code}" 缺少 resolvedPrompt，请检查服务端是否正确下发`);
            }

            // 构建 messages
            const messages: Array<{ role: string; content: string }> = [];
            if (config.systemPrompt) {
                messages.push({ role: 'system', content: config.systemPrompt });
            }
            messages.push({ role: 'user', content: prompt });

            console.log(`[LlmApiExecutor] ${definition.code}: model=${model}, baseUrl=${baseUrl}, prompt length=${prompt.length}`);
            console.log(`[LlmApiExecutor] Config merge detail — capConfig.model=${capConfig.model}, agentConfig.model=${agentConfig.model}, params.model=${mergedParams.model}, final.model=${model}`);
            console.log(`[LlmApiExecutor] Full config keys:`, Object.keys(config), 'agentConfig raw:', JSON.stringify(parseAgentConfig(definition.agentConfig)));

            // 标准化 baseUrl（去除末尾斜杠，确保路径正确）
            const normalizedUrl = normalizeBaseUrl(baseUrl);

            const response = await fetch(`${normalizedUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: model || DEFAULTS.model,
                    messages,
                    max_tokens: maxTokens || DEFAULTS.maxTokens,
                    temperature: temperature ?? DEFAULTS.temperature,
                    stream: false,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LLM API 请求失败 (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            const tokenCount = data.usage?.total_tokens;

            return {
                success: true,
                output: content,
                durationMs: Date.now() - startTime,
                tokenCount,
            };
        } catch (err: any) {
            return {
                success: false,
                output: null,
                durationMs: Date.now() - startTime,
                error: err?.message || String(err),
            };
        }
    }

    async *executeStream(definition: AgentDefinition, input: AgentExecuteInput): AsyncGenerator<AgentStreamChunk> {
        const capConfig = this.getCapabilityConfig(definition);
        const agentConfig = this.filterEmpty(parseAgentConfig(definition.agentConfig));
        const mergedParams = this.filterEmpty(input.params || {});
        const config: Record<string, any> = { ...DEFAULTS, ...capConfig, ...agentConfig, ...mergedParams };

        const { baseUrl, apiKey, model, maxTokens, temperature } = config;

        if (!baseUrl || !apiKey) {
            yield { text: '', status: 'error' };
            return;
        }

        const prompt = config.resolvedPrompt;
        if (!prompt) {
            yield { text: '', status: 'error' };
            return;
        }

        const messages: Array<{ role: string; content: string }> = [];
        if (config.systemPrompt) {
            messages.push({ role: 'system', content: config.systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const normalizedUrl = normalizeBaseUrl(baseUrl);

        const response = await fetch(`${normalizedUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model || DEFAULTS.model,
                messages,
                max_tokens: maxTokens || DEFAULTS.maxTokens,
                temperature: temperature ?? DEFAULTS.temperature,
                stream: true,
            }),
        });

        if (!response.ok || !response.body) {
            yield { text: '', status: 'error' };
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            fullText += delta;
                            yield { text: delta, status: 'streaming' };
                        }
                    } catch {
                        // 跳过解析失败的行
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield { text: '', status: 'complete', parsedOutput: { content: fullText } };
    }
}

/** 标准化 baseUrl：去除末尾斜杠，处理带或不带 /v1 的情况 */
function normalizeBaseUrl(url: string): string {
    let normalized = url.replace(/\/+$/, '');
    // 如果 URL 没有以 /v1 结尾，且不包含路径（如 https://api.deepseek.com），自动追加
    if (!normalized.match(/\/v\d+$/)) {
        normalized += '/v1';
    }
    return normalized;
}
