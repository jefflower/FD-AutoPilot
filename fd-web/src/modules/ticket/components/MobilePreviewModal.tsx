import React, { useState } from 'react';

interface MobilePreviewModalProps {
    token: string;
    onClose: () => void;
}

const PRESETS = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone 14', width: 390, height: 844 },
    { name: 'Android', width: 360, height: 800 },
] as const;

const MobilePreviewModal: React.FC<MobilePreviewModalProps> = ({ token, onClose }) => {
    const [preset, setPreset] = useState(0);
    const [isLandscape, setIsLandscape] = useState(false);

    const { width, height } = PRESETS[preset];
    const frameW = isLandscape ? height : width;
    const frameH = isLandscape ? width : height;

    const previewUrl = `/m/audit?token=${encodeURIComponent(token)}`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
                {/* Controls */}
                <div className="flex items-center gap-3 bg-slate-800/90 rounded-xl px-4 py-2 border border-white/10">
                    {PRESETS.map((p, i) => (
                        <button
                            key={p.name}
                            onClick={() => setPreset(i)}
                            className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                                preset === i
                                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            {p.name}
                        </button>
                    ))}
                    <div className="w-px h-4 bg-white/10" />
                    <button
                        onClick={() => setIsLandscape(!isLandscape)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors"
                        title={isLandscape ? '竖屏' : '横屏'}
                    >
                        <svg className={`w-4 h-4 transition-transform ${isLandscape ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="5" y="2" width="14" height="20" rx="2" strokeWidth={2} />
                        </svg>
                    </button>
                    <div className="w-px h-4 bg-white/10" />
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Phone frame */}
                <div
                    className="bg-slate-950 rounded-[2.5rem] p-3 shadow-2xl border border-slate-700/50 transition-all duration-300"
                    style={{ width: frameW + 24, height: frameH + 24 }}
                >
                    {/* Notch */}
                    <div className="flex justify-center mb-1">
                        <div className="w-24 h-5 bg-slate-950 rounded-b-2xl" />
                    </div>
                    <iframe
                        src={previewUrl}
                        className="w-full rounded-2xl bg-slate-900"
                        style={{ width: frameW, height: frameH - 30 }}
                        title="Mobile Preview"
                    />
                </div>

                {/* Size label */}
                <div className="text-xs text-slate-500 font-mono">
                    {frameW} x {frameH} &middot; {PRESETS[preset].name}
                </div>
            </div>
        </div>
    );
};

export default MobilePreviewModal;
