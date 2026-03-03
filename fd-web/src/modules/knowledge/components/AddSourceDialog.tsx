import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X, Globe, Type } from 'lucide-react';

type AddMode = 'file' | 'url' | 'text';

interface AddSourceDialogProps {
    open: boolean;
    onClose: () => void;
    onUploadFile: (file: File) => void;
    onAddText: (data: { title: string; sourceType: 'TEXT' | 'MARKDOWN'; content: string }) => void;
    onAddUrl: (data: { title: string; sourceType: 'URL'; url: string }) => void;
    uploading: boolean;
}

const TAB_CONFIG: { mode: AddMode; icon: React.ElementType; labelKey: string }[] = [
    { mode: 'file', icon: Upload, labelKey: 'source.addFile' },
    { mode: 'url', icon: Globe, labelKey: 'source.addUrl' },
    { mode: 'text', icon: Type, labelKey: 'source.addText' },
];

const AddSourceDialog: React.FC<AddSourceDialogProps> = ({
    open, onClose, onUploadFile, onAddText, onAddUrl, uploading,
}) => {
    const { t } = useTranslation('knowledge');
    const [mode, setMode] = useState<AddMode>('file');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [url, setUrl] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!open) return null;

    const reset = () => {
        setTitle('');
        setContent('');
        setUrl('');
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const handleFileSelect = (file: File) => {
        onUploadFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileSelect(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(true);
    };

    const handleDragLeave = () => setDragActive(false);

    const handleSubmitText = () => {
        if (!title.trim() || !content.trim()) return;
        onAddText({ title: title.trim(), sourceType: 'TEXT', content: content.trim() });
        reset();
    };

    const handleSubmitUrl = () => {
        if (!title.trim() || !url.trim()) return;
        onAddUrl({ title: title.trim(), sourceType: 'URL', url: url.trim() });
        reset();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

            {/* Dialog */}
            <div className="relative w-[520px] max-h-[80vh] bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">{t('source.add')}</h3>
                    <button onClick={handleClose} className="p-1 rounded-lg hover:bg-white/10 text-slate-400 transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* Mode tabs */}
                <div className="px-5 pt-3 flex gap-1">
                    {TAB_CONFIG.map(({ mode: m, icon: Icon, labelKey }) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                mode === m
                                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                    : 'bg-white/5 text-slate-400 border border-transparent hover:bg-white/10 hover:text-white'
                            }`}
                        >
                            <Icon size={12} />
                            {t(labelKey as any)}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-5">
                    {mode === 'file' && (
                        <div>
                            <div
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                                    dragActive
                                        ? 'border-amber-500/50 bg-amber-500/5'
                                        : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                                }`}
                            >
                                <Upload size={24} className="mx-auto mb-3 text-slate-500" />
                                <p className="text-xs text-slate-300 mb-1">
                                    {uploading ? t('source.uploading') : t('source.addFile')}
                                </p>
                                <p className="text-[10px] text-slate-600">{t('source.fileHint')}</p>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.csv,.txt,.md,.docx"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFileSelect(file);
                                    e.target.value = '';
                                }}
                            />
                        </div>
                    )}

                    {mode === 'url' && (
                        <div className="space-y-3">
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">{t('source.title')}</label>
                                <input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={t('source.titlePlaceholder')}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">{t('source.url')}</label>
                                <input
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder={t('source.urlPlaceholder')}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                                />
                            </div>
                            <button
                                onClick={handleSubmitUrl}
                                disabled={!title.trim() || !url.trim()}
                                className="w-full py-2 bg-amber-600/40 hover:bg-amber-600/60 disabled:opacity-30 text-amber-300 text-xs font-bold rounded-lg transition-all"
                            >
                                {t('button.confirm', { ns: 'common' })}
                            </button>
                        </div>
                    )}

                    {mode === 'text' && (
                        <div className="space-y-3">
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">{t('source.title')}</label>
                                <input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={t('source.titlePlaceholder')}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 block mb-1">{t('source.content')}</label>
                                <textarea
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    placeholder={t('source.contentPlaceholder')}
                                    rows={8}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/30 transition-colors resize-none font-mono"
                                />
                            </div>
                            <button
                                onClick={handleSubmitText}
                                disabled={!title.trim() || !content.trim()}
                                className="w-full py-2 bg-amber-600/40 hover:bg-amber-600/60 disabled:opacity-30 text-amber-300 text-xs font-bold rounded-lg transition-all"
                            >
                                {t('button.confirm', { ns: 'common' })}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddSourceDialog;
