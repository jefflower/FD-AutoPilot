import React from 'react';
import { useTranslation } from 'react-i18next';

interface AiReplyPanelProps {
    generatingAiReply: boolean;
    aiReplyText: string;
    mqStreamingText: string;
    aiError: string | null;
    aiReplies: [string, string] | null;
    aiReplyLang: 'original' | 'cn';
    setAiReplyLang: (lang: 'original' | 'cn') => void;
    tempAiReply: [string, string] | null;
    submitting: boolean;
    showPrompts: boolean;
    setShowPrompts: (show: boolean) => void;
    currentPrompt: string;
    isSplitMode: boolean;
    aiResponseEndRef: React.RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onDiscard: () => void;
    onConfirmReply: () => void;
}

const AiReplyPanel: React.FC<AiReplyPanelProps> = ({
    generatingAiReply,
    aiReplyText,
    mqStreamingText,
    aiError,
    aiReplies,
    aiReplyLang,
    setAiReplyLang,
    tempAiReply,
    submitting,
    showPrompts,
    setShowPrompts,
    currentPrompt,
    isSplitMode,
    aiResponseEndRef,
    onClose,
    onDiscard,
    onConfirmReply,
}) => {
    const { t } = useTranslation(['tickets', 'common']);
    const hasContent = generatingAiReply || aiReplyText || mqStreamingText || aiError;
    if (!hasContent) return null;

    return (
        <div className="relative mt-2 group">
            {/* 装饰边框背景 */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500/20 via-indigo-500/20 to-pink-500/20 rounded-2xl blur opacity-30 group-hover:opacity-100 transition duration-1000"></div>

            <div className={`relative rounded-xl overflow-hidden border shadow-2xl transition-all duration-500 ${aiError
                ? 'bg-slate-900/90 border-red-500/40'
                : 'bg-slate-900/90 border-purple-500/30'
                }`}>

                {/* AI Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-white/5 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${aiError
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/20'
                            }`}>
                            {aiError ? '!' : 'AI'}
                        </div>
                        <span className="text-[11px] font-black text-white uppercase tracking-wider">
                            {aiError ? t('reply.generationError') : t('reply.notebookResponse')}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        {!aiError && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowPrompts(!showPrompts); }}
                                className={`px-3 py-1 text-[9px] font-black rounded-lg border transition-all ${showPrompts ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/20'}`}
                            >
                                {showPrompts ? t('reply.hidePrompts') : t('reply.viewPrompts')}
                            </button>
                        )}
                        <div className="flex items-center gap-2">
                            {aiReplies && !aiError && !generatingAiReply && (
                                <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/10 mr-2">
                                    <button
                                        onClick={() => setAiReplyLang('original')}
                                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${aiReplyLang === 'original' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        {t('reply.originTab')}
                                    </button>
                                    <button
                                        onClick={() => setAiReplyLang('cn')}
                                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${aiReplyLang === 'cn' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        {t('reply.chineseTab')}
                                    </button>
                                </div>
                            )}
                            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* AI Content Area */}
                <div className="p-6 overflow-hidden">
                    {showPrompts ? (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                                {t('reply.promptDebugger')}
                            </div>
                            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                                <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed selection:bg-indigo-500/30">
                                    {currentPrompt || t('reply.promptProcessing')}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <div className={`min-h-[100px] text-sm leading-relaxed whitespace-pre-wrap transition-all ${aiError ? 'text-red-400 font-mono' : 'text-slate-200'}`}>
                            {aiError ? (
                                <div className="flex items-start gap-2">
                                    <span className="mt-1">&#x274C;</span>
                                    <span>{aiError}</span>
                                </div>
                            ) : aiReplies ? (
                                <div className="animate-in fade-in duration-500">
                                    {isSplitMode ? (
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-slate-800/60 p-4 rounded-lg border border-slate-700/50">
                                                <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">{t('reply.targetLangReply')}</div>
                                                <div className="text-sm text-slate-200 whitespace-pre-wrap">{aiReplies[0]}</div>
                                            </div>
                                            <div className="bg-emerald-900/40 p-4 rounded-lg border border-emerald-700/50">
                                                <div className="text-[10px] font-bold text-emerald-500 mb-2 uppercase tracking-wider">{t('reply.chineseReply')}</div>
                                                <div className="text-sm text-emerald-100 whitespace-pre-wrap">{aiReplies[1]}</div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="bg-slate-800/60 p-4 rounded-lg border border-slate-700/50">
                                                <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">{t('reply.targetLangReply')}</div>
                                                <div className="text-sm text-slate-200 whitespace-pre-wrap">{aiReplies[0]}</div>
                                            </div>
                                            <div className="bg-emerald-900/40 p-4 rounded-lg border border-emerald-700/50">
                                                <div className="text-[10px] font-bold text-emerald-500 mb-2 uppercase tracking-wider">{t('reply.chineseReply')}</div>
                                                <div className="text-sm text-emerald-100 whitespace-pre-wrap">{aiReplies[1]}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (aiReplyText || mqStreamingText) ? (
                                <div className="flex flex-col">
                                    {aiReplyText || mqStreamingText}
                                    {generatingAiReply && <span className="inline-block w-1 h-4 ml-1 bg-purple-500 animate-pulse align-middle"></span>}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-6 gap-3">
                                    <div className="flex gap-1.5 item-center">
                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.3s]"></div>
                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:-0.15s]"></div>
                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce"></div>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest animate-pulse">{t('reply.analyzingContext')}</span>
                                </div>
                            )}
                        </div>
                    )}
                    <div ref={aiResponseEndRef} />
                </div>

                {/* AI Actions / Save & Discard */}
                {aiReplies && !aiError && !generatingAiReply && (
                    <div className="bg-gradient-to-r from-purple-600/10 to-indigo-600/10 border-t border-purple-500/20 p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {tempAiReply ? (
                                    <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                                        <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
                                        {t('reply.waitingConfirm')}
                                    </span>
                                ) : (
                                    <span className="text-[10px] font-bold text-slate-500">
                                        {t('reply.completedHint')}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        const text = aiReplies ? `${aiReplies[0]}\n\n---\n\n${aiReplies[1]}` : aiReplyText;
                                        navigator.clipboard.writeText(text);
                                        alert(t('reply.copiedToClipboard'));
                                    }}
                                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-[10px] font-black border border-white/10 flex items-center gap-1.5 transition-all"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                    {t('reply.copyAll')}
                                </button>
                                <button
                                    onClick={onDiscard}
                                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-[10px] font-black border border-white/10 transition-all"
                                >
                                    {t('reply.discard')}
                                </button>
                                {tempAiReply && (
                                    <button
                                        onClick={onConfirmReply}
                                        disabled={submitting}
                                        className="px-5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-md text-[10px] font-black shadow-lg shadow-purple-500/30 transition-all flex items-center gap-2 animate-pulse"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                        {submitting ? t('reply.savingReply') : t('reply.saveReply')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AiReplyPanel;
