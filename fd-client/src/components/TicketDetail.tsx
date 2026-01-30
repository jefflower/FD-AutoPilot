import React, { useState, useRef, useEffect } from 'react';
import { Ticket, NotebookLMConfig } from '../types';
import { LangLabel } from './Common';
import { NotebookShadowService } from '../services/notebookShadow';

interface TicketDetailProps {
    selectedTicket: Ticket;
    displayLang: 'original' | 'cn' | 'en';
    isTranslating: boolean;
    handleSwitchToOriginal: () => void;
    handleTranslate: (lang: 'cn' | 'en', force?: boolean) => void;
    navigateToTicket: (id: number) => void;
    setLogs: (updater: (prev: string[]) => string[]) => void;
    notebookLMConfig: NotebookLMConfig;
}

const TicketDetail: React.FC<TicketDetailProps> = ({
    selectedTicket,
    displayLang,
    isTranslating,
    handleSwitchToOriginal,
    handleTranslate,
    navigateToTicket,
    setLogs,
    notebookLMConfig
}) => {
    const [generatingAiReplyFor, setGeneratingAiReplyFor] = useState<number | null>(null);
    const [aiResponse, setAiResponse] = useState<string>(''); // 原始响应文本
    const [aiReplies, setAiReplies] = useState<[string, string] | null>(null); // [工单语言, 中文]
    const [aiReplyLang, setAiReplyLang] = useState<'original' | 'cn'>('original'); // 当前显示的语言
    const [aiError, setAiError] = useState<string | null>(null);
    const [showShadow, setShowShadow] = useState(false);
    const aiResponseEndRef = useRef<HTMLDivElement>(null);

    // 自动滚动 AI 回复到底部
    useEffect(() => {
        if (aiResponse) {
            aiResponseEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [aiResponse]);

    // Render text with clickable ticket links
    const renderTextWithLinks = (text: string | null) => {
        if (!text) return null;
        const regex = /(合并到工单\s*|合并来自工单\s*|merged into ticket\s*|merged from ticket\s*)(\d+)/gi;
        const parts = [];
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(text.substring(lastIndex, match.index));
            }
            const prefix = match[1];
            const ticketId = parseInt(match[2]);
            parts.push(
                <span key={match.index}>
                    {prefix}
                    <button
                        onClick={() => navigateToTicket(ticketId)}
                        className="text-indigo-400 hover:text-indigo-300 hover:underline font-medium inline-block p-0 bg-transparent border-none cursor-pointer"
                    >
                        {ticketId}
                    </button>
                </span>
            );
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) {
            parts.push(text.substring(lastIndex));
        }
        return <>{parts}</>;
    };

    const handleAiReply = async (conversationId: number) => {
        if (!notebookLMConfig.notebookId) {
            alert('请先在“设置”中配置 Notebook ID');
            return;
        }

        setGeneratingAiReplyFor(conversationId);
        setAiResponse('');
        setAiReplies(null);
        setAiReplyLang('original');
        setAiError(null);

        try {
            setLogs(prev => [...prev, `🤖 AI Browser Reply requested for ticket #${selectedTicket.id}`]);

            // 构造上下文
            let context = `Subject: ${selectedTicket.subject}\n\nDescription: ${selectedTicket.description_text || 'No description'}\n\n`;
            if (selectedTicket.conversations && selectedTicket.conversations.length > 0) {
                context += "Conversations history:\n";
                for (const conv of selectedTicket.conversations) {
                    context += `${conv.incoming ? 'Customer' : 'Agent'}: ${conv.body_text}\n`;
                    if (conv.id === conversationId) break;
                }
            }

            // 构造 Prompt
            const finalPrompt = (notebookLMConfig.prompt || '请根据以下工单内容回答我的问题:\n\n${工单内容}').replace('${工单内容}', context);

            const shadowService = new NotebookShadowService(notebookLMConfig.notebookId, notebookLMConfig.notebookUrl);

            // 使用影子窗口进行流式渲染
            for await (const chunk of shadowService.query(finalPrompt)) {
                if (chunk.status === 'error') {
                    setAiError(chunk.text);
                    break;
                }
                setAiResponse(chunk.text);

                // 尝试解析 JSON 数组格式
                if (chunk.status === 'complete' || (chunk.text.includes('[') && chunk.text.includes(']'))) {
                    try {
                        let parsed = null;
                        let textToParse = chunk.text.trim();

                        // 提取 JSON 数组部分
                        const startIdx = textToParse.indexOf('[');
                        const endIdx = textToParse.lastIndexOf(']');
                        if (startIdx !== -1 && endIdx > startIdx) {
                            textToParse = textToParse.substring(startIdx, endIdx + 1);
                        }

                        // 尝试直接解析
                        try {
                            parsed = JSON.parse(textToParse);
                        } catch {
                            // 如果解析失败，可能是换行符问题，尝试手动提取
                            // 匹配 ["xxx", "yyy"] 格式，其中 xxx 和 yyy 可以包含任何字符
                            const match = textToParse.match(/^\[\s*"([\s\S]*?)"\s*,\s*"([\s\S]*?)"\s*\]$/);
                            if (match) {
                                // 手动提取两个字符串，处理转义字符
                                const str1 = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                const str2 = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                                parsed = [str1, str2];
                                console.log('[AI Reply] Used regex extraction for bilingual response');
                            }
                        }

                        if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
                            console.log('[AI Reply] Successfully parsed bilingual response');
                            setAiReplies([parsed[0], parsed[1]]);
                        }
                    } catch (e) {
                        // 解析失败时保持原始文本显示
                        console.log('[AI Reply] JSON parse attempt failed:', e);
                    }
                }
            }

            setLogs(prev => [...prev, `✅ AI Reply generated via Shadow Browser`]);
        } catch (error: any) {
            console.error('[Browser API Error]', error);
            const errMsg = error.message || String(error);
            setAiError(errMsg);
            setLogs(prev => [...prev, `❌ AI Browser error: ${errMsg}`]);
        } finally {
            setGeneratingAiReplyFor(null);
        }
    };

    const toggleShadowWindow = async () => {
        const shadowService = new NotebookShadowService(notebookLMConfig.notebookId, notebookLMConfig.notebookUrl);
        if (showShadow) {
            await shadowService.hide();
            setShowShadow(false);
        } else {
            await shadowService.show();
            setShowShadow(true);
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-slate-800/30 overflow-hidden relative h-full">
            <div className="px-4 py-4 border-b border-white/10 flex-shrink-0 flex items-center justify-between h-[72px]">
                <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-indigo-400 text-[10px] leading-tight flex-shrink-0">#{selectedTicket.id}</span>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={toggleShadowWindow}
                                className={`p-1 rounded-md transition-all ${showShadow ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500/50' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                                title={showShadow ? "隐藏影子浏览器" : "显示影子浏览器 (用于登录 Google)"}
                                disabled={!notebookLMConfig.notebookId}
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </button>
                            {/* AI 回复按钮 - 移到标题栏 */}
                            <button
                                onClick={() => handleAiReply(selectedTicket.conversations?.length ? selectedTicket.conversations[selectedTicket.conversations.length - 1].id : 0)}
                                disabled={generatingAiReplyFor !== null || !notebookLMConfig.notebookId}
                                className={`px-2.5 py-1 text-xs rounded-lg transition-all flex items-center gap-1.5 font-medium ${generatingAiReplyFor !== null
                                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white cursor-wait animate-pulse'
                                    : 'bg-gradient-to-r from-purple-500/80 to-pink-500/80 text-white hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/20'
                                    }`}
                                title="使用 NotebookLM AI 生成回复建议"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                {generatingAiReplyFor !== null ? 'AI 思考中...' : 'AI 回复'}
                            </button>
                            <div className="flex gap-1 overflow-x-auto">
                                {selectedTicket.available_langs?.map(l => <LangLabel key={l} lang={l} />)}
                            </div>
                        </div>
                    </div>
                    <h2 className="text-lg font-bold text-white truncate leading-tight">{selectedTicket.subject}</h2>
                </div>

                {/* Language Toggle */}
                <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/10 h-8 flex-shrink-0 ml-2">
                    <button
                        onClick={handleSwitchToOriginal}
                        disabled={isTranslating}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${displayLang === 'original' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                    >Original</button>
                    {(['cn', 'en'] as const).map(l => (
                        <button
                            key={l}
                            onClick={() => handleTranslate(l)}
                            disabled={isTranslating}
                            className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${displayLang === l ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                            <span className="flex items-center gap-1">
                                {isTranslating && displayLang === l ? '...' : l === 'cn' ? '中文' : 'English'}
                                {displayLang === l && !isTranslating && (
                                    <div
                                        onClick={(e) => { e.stopPropagation(); handleTranslate(l, true); }}
                                        className="hover:bg-white/20 p-0.5 rounded transition-colors"
                                        title="Re-translate"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                    </div>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {isTranslating && (
                    <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-10 flex items-center justify-center">
                        <div className="text-white flex flex-col items-center">
                            <svg className="animate-spin h-8 w-8 mb-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                            <span>Translating with Gemini AI...</span>
                        </div>
                    </div>
                )}


                <div className="bg-white/5 rounded-lg p-3 relative group">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-blue-200">工单描述</span>
                        <span className="text-xs text-slate-500">{selectedTicket.created_at.substring(0, 16)}</span>
                    </div>
                    <p className="text-slate-200 text-sm whitespace-pre-wrap">
                        {renderTextWithLinks(selectedTicket.description_text) || 'No description'}
                    </p>
                </div>
                {selectedTicket.conversations?.map((conv) => (
                    <div key={conv.id} className={`p-3 rounded-lg relative group ${conv.incoming ? 'bg-slate-700/50 mr-6' : 'bg-indigo-500/20 ml-6'}`}>
                        <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${conv.incoming ? 'bg-slate-600 text-slate-300' : 'bg-indigo-500/30 text-indigo-300'}`}>{conv.incoming ? 'Customer' : 'Agent'}</span>
                            <span className="text-xs text-slate-500">{conv.created_at.substring(0, 16)}</span>
                        </div>
                        <p className="text-slate-200 text-sm whitespace-pre-wrap">{renderTextWithLinks(conv.body_text)}</p>
                    </div>
                ))}

                {/* AI 回复区块 - 放在工单最后，有明显的样式区分 */}
                {(aiResponse || aiError || generatingAiReplyFor !== null) && (
                    <div className="relative mt-4">
                        {/* 分隔线 */}
                        <div className="absolute -top-2 left-0 right-0 flex items-center">
                            <div className="flex-1 border-t border-dashed border-purple-500/30"></div>
                            <span className="px-3 text-[10px] text-purple-400/60 bg-slate-800/80">AI 智能回复</span>
                            <div className="flex-1 border-t border-dashed border-purple-500/30"></div>
                        </div>

                        <div className={`rounded-xl p-4 shadow-2xl border-2 backdrop-blur-sm ${aiError
                            ? 'bg-gradient-to-br from-red-900/40 to-red-950/60 border-red-500/40'
                            : 'bg-gradient-to-br from-purple-900/30 via-indigo-900/30 to-pink-900/30 border-purple-500/40'
                            }`}>
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${aiError
                                        ? 'bg-red-500/30 text-red-300'
                                        : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30'
                                        }`}>
                                        {aiError ? '⚠️' : '✨'}
                                    </div>
                                    <div>
                                        <span className={`font-bold text-sm ${aiError ? 'text-red-300' : 'text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-pink-300'}`}>
                                            {aiError ? 'AI 回复出错' : 'NotebookLM AI 建议'}
                                        </span>
                                        {!aiError && generatingAiReplyFor === null && aiResponse && (
                                            <p className="text-[10px] text-purple-400/60">基于工单上下文智能生成</p>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setAiResponse(''); setAiError(null); setGeneratingAiReplyFor(null); }}
                                    className="text-slate-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-all"
                                    title="关闭"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            {/* 语言切换按钮 - 仅在有双语回复时显示 */}
                            {aiReplies && !aiError && generatingAiReplyFor === null && (
                                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                                    <span className="text-[10px] text-slate-400">查看语言：</span>
                                    <div className="flex bg-slate-900/50 rounded-lg p-0.5 border border-white/10">
                                        <button
                                            onClick={() => setAiReplyLang('original')}
                                            className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${aiReplyLang === 'original'
                                                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                                                : 'text-slate-400 hover:text-white'
                                                }`}
                                        >
                                            🌐 工单语言
                                        </button>
                                        <button
                                            onClick={() => setAiReplyLang('cn')}
                                            className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${aiReplyLang === 'cn'
                                                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                                                : 'text-slate-400 hover:text-white'
                                                }`}
                                        >
                                            🇨🇳 中文
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className={`text-sm whitespace-pre-wrap font-sans leading-relaxed min-h-[60px] ${aiError
                                ? 'text-red-200 font-mono text-xs bg-red-950/50 p-3 rounded-lg border border-red-500/20'
                                : 'text-slate-100 bg-white/5 p-4 rounded-lg border border-white/10'
                                }`}>
                                {aiError ? (
                                    <div>{aiError}</div>
                                ) : aiReplies ? (
                                    // 显示解析后的双语回复
                                    <div>{aiReplyLang === 'original' ? aiReplies[0] : aiReplies[1]}</div>
                                ) : aiResponse || (
                                    <div className="flex flex-col gap-3 py-2">
                                        <div className="flex items-center gap-3">
                                            <div className="flex gap-1">
                                                <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                <span className="w-2 h-2 rounded-full bg-pink-500 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                            </div>
                                            <span className="text-purple-300/80">AI 正在分析工单内容并生成回复建议...</span>
                                        </div>
                                        <div className="text-[10px] text-slate-500 italic">
                                            💡 提示：若长时间无反应，请点击标题栏的 <span className="text-purple-400">👁️</span> 按钮检查是否需要登录 Google
                                        </div>
                                    </div>
                                )}
                                <div ref={aiResponseEndRef} />
                            </div>

                            {(aiResponse || aiReplies) && !aiError && generatingAiReplyFor === null && (
                                <div className="mt-4 flex gap-2">
                                    <button
                                        onClick={() => {
                                            const textToCopy = aiReplies
                                                ? (aiReplyLang === 'original' ? aiReplies[0] : aiReplies[1])
                                                : aiResponse;
                                            navigator.clipboard.writeText(textToCopy);
                                            alert('已复制到剪贴板');
                                        }}
                                        className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-purple-500/30"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                        复制{aiReplies ? (aiReplyLang === 'original' ? '工单语言' : '中文') : ''}回复
                                    </button>
                                    {aiReplies && (
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(`[工单语言]\n${aiReplies[0]}\n\n[中文]\n${aiReplies[1]}`);
                                                alert('已复制双语回复到剪贴板');
                                            }}
                                            className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-slate-200 rounded-lg text-xs font-medium transition-all flex items-center gap-2 border border-white/10"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                            复制双语
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TicketDetail;
