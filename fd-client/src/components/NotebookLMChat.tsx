import React, { useState, useRef, useEffect } from 'react';
// 注意: notebookLM 模块不存在，使用本地类型声明
// import {
//     NotebookLMClient,
//     NotebookLMConfig,
//     NotebookLMConfigManager,
//     generateExtractScript
// } from '../services/notebookLM';

// 临时类型声明 - TODO: 需要创建或导入实际的 notebookLM 服务
interface NotebookLMConfig {
    cookie: string;
    atToken: string;
    fSid: string;
    notebookId: string;
}

const NotebookLMConfigManager = {
    loadConfig: (): NotebookLMConfig | null => {
        const saved = localStorage.getItem('notebookLM_config');
        return saved ? JSON.parse(saved) : null;
    },
    saveConfig: (config: NotebookLMConfig) => {
        localStorage.setItem('notebookLM_config', JSON.stringify(config));
    },
    validateConfig: (config: NotebookLMConfig) => {
        return !!(config.cookie && config.atToken && config.fSid && config.notebookId);
    }
};

class NotebookLMClient {
    constructor(_config: NotebookLMConfig) { }
    async query(_params: { query: string }): Promise<string> {
        return 'NotebookLM 服务暂未配置';
    }
    async *queryStream(_params: { query: string }): AsyncGenerator<{ text: string }> {
        yield { text: 'NotebookLM 服务暂未配置' };
    }
}

const generateExtractScript = () => `
// 在 NotebookLM 页面的浏览器控制台中运行此脚本
console.log('请手动提取 Cookie, AT Token 和 F.SID');
`;

import './NotebookLMChat.css';

/**
 * NotebookLM 聊天组件
 */
export const NotebookLMChat: React.FC = () => {
    // 配置状态
    const [config, setConfig] = useState<NotebookLMConfig | null>(null);
    const [showConfig, setShowConfig] = useState(false);

    // 配置表单
    const [formData, setFormData] = useState({
        cookie: '',
        atToken: '',
        fSid: '',
        notebookId: '7662c1de-8bba-4d54-b834-e38161f942f4'
    });

    // 聊天状态
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [useStreaming, setUseStreaming] = useState(true);

    // 客户端实例
    const clientRef = useRef<NotebookLMClient | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 加载保存的配置
    useEffect(() => {
        const savedConfig = NotebookLMConfigManager.loadConfig();
        if (savedConfig && NotebookLMConfigManager.validateConfig(savedConfig)) {
            setConfig(savedConfig);
            setFormData(savedConfig);
            clientRef.current = new NotebookLMClient(savedConfig);
        } else {
            setShowConfig(true);
        }
    }, []);

    // 自动滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    /**
     * 保存配置
     */
    const handleSaveConfig = () => {
        if (!NotebookLMConfigManager.validateConfig(formData)) {
            alert('请填写完整的配置信息');
            return;
        }

        setConfig(formData);
        NotebookLMConfigManager.saveConfig(formData);
        clientRef.current = new NotebookLMClient(formData);
        setShowConfig(false);
    };

    /**
     * 复制提取脚本
     */
    const handleCopyScript = () => {
        navigator.clipboard.writeText(generateExtractScript());
        alert('已复制提取脚本到剪贴板!\n请在NotebookLM页面的浏览器console中运行');
    };

    /**
     * 发送消息(非流式)
     */
    const handleSendMessage = async () => {
        if (!input.trim() || !clientRef.current) return;

        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setIsLoading(true);

        try {
            if (useStreaming) {
                // 流式响应
                let assistantMessage = '';
                setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

                const stream = clientRef.current.queryStream({ query: userMessage });

                for await (const chunk of stream) {
                    assistantMessage += chunk.text + '\n';
                    setMessages(prev => {
                        const newMessages = [...prev];
                        newMessages[newMessages.length - 1].content = assistantMessage;
                        return newMessages;
                    });
                }
            } else {
                // 非流式响应
                const response = await clientRef.current.query({ query: userMessage });
                setMessages(prev => [...prev, { role: 'assistant', content: response }]);
            }
        } catch (error) {
            console.error('Query error:', error);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `错误: ${error instanceof Error ? error.message : '未知错误'}`
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * 清除对话
     */
    const handleClearChat = () => {
        setMessages([]);
    };

    /**
     * 配置面板
     */
    const renderConfigPanel = () => (
        <div className="config-panel">
            <h2>NotebookLM 配置</h2>

            <div className="config-instructions">
                <h3>如何获取配置信息:</h3>
                <ol>
                    <li>在浏览器中打开NotebookLM页面并登录</li>
                    <li>打开浏览器开发者工具(F12)</li>
                    <li>在任意输入框输入问题并发送</li>
                    <li>在Network标签页找到 <code>GenerateFreeFormStreamed</code> 请求</li>
                    <li>复制以下信息:
                        <ul>
                            <li><strong>Cookie</strong>: Request Headers → Cookie (完整字符串)</li>
                            <li><strong>at Token</strong>: Request Payload → at</li>
                            <li><strong>f.sid</strong>: Query String Parameters → f.sid</li>
                            <li><strong>Notebook ID</strong>: URL最后一段 (已预填)</li>
                        </ul>
                    </li>
                </ol>

                <button onClick={handleCopyScript} className="copy-script-btn">
                    复制提取脚本
                </button>
            </div>

            <div className="config-form">
                <div className="form-group">
                    <label>Cookie:</label>
                    <textarea
                        value={formData.cookie}
                        onChange={e => setFormData({ ...formData, cookie: e.target.value })}
                        placeholder="粘贴完整的Cookie字符串"
                        rows={3}
                    />
                </div>

                <div className="form-group">
                    <label>AT Token:</label>
                    <input
                        type="text"
                        value={formData.atToken}
                        onChange={e => setFormData({ ...formData, atToken: e.target.value })}
                        placeholder="粘贴at token值"
                    />
                </div>

                <div className="form-group">
                    <label>F.SID:</label>
                    <input
                        type="text"
                        value={formData.fSid}
                        onChange={e => setFormData({ ...formData, fSid: e.target.value })}
                        placeholder="粘贴f.sid值"
                    />
                </div>

                <div className="form-group">
                    <label>Notebook ID:</label>
                    <input
                        type="text"
                        value={formData.notebookId}
                        onChange={e => setFormData({ ...formData, notebookId: e.target.value })}
                        placeholder="笔记本ID"
                    />
                </div>

                <div className="form-actions">
                    <button onClick={handleSaveConfig} className="save-btn">
                        保存配置
                    </button>
                    {config && (
                        <button onClick={() => setShowConfig(false)} className="cancel-btn">
                            取消
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    /**
     * 聊天界面
     */
    const renderChat = () => (
        <div className="chat-container">
            <div className="chat-header">
                <h2>NotebookLM AI 对话</h2>
                <div className="chat-controls">
                    <label className="streaming-toggle">
                        <input
                            type="checkbox"
                            checked={useStreaming}
                            onChange={e => setUseStreaming(e.target.checked)}
                        />
                        流式响应
                    </label>
                    <button onClick={() => setShowConfig(true)} className="config-btn">
                        ⚙️ 配置
                    </button>
                    <button onClick={handleClearChat} className="clear-btn">
                        🗑️ 清空
                    </button>
                </div>
            </div>

            <div className="messages-container">
                {messages.length === 0 && (
                    <div className="empty-state">
                        <p>👋 开始与NotebookLM对话</p>
                        <p className="hint">提示: 确保已正确配置Cookie和Token</p>
                    </div>
                )}

                {messages.map((msg, idx) => (
                    <div key={idx} className={`message ${msg.role}`}>
                        <div className="message-avatar">
                            {msg.role === 'user' ? '👤' : '🤖'}
                        </div>
                        <div className="message-content">
                            <pre>{msg.content}</pre>
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="message assistant loading">
                        <div className="message-avatar">🤖</div>
                        <div className="message-content">
                            <div className="loading-dots">
                                <span>.</span><span>.</span><span>.</span>
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="input-container">
                <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                        }
                    }}
                    placeholder="输入你的问题... (Enter发送, Shift+Enter换行)"
                    rows={3}
                    disabled={isLoading}
                />
                <button
                    onClick={handleSendMessage}
                    disabled={isLoading || !input.trim()}
                    className="send-btn"
                >
                    {isLoading ? '发送中...' : '发送'}
                </button>
            </div>
        </div>
    );

    return (
        <div className="notebooklm-chat">
            {showConfig ? renderConfigPanel() : renderChat()}
        </div>
    );
};

export default NotebookLMChat;
