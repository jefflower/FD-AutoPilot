import React from 'react';
import { useTranslation } from 'react-i18next';

interface TranslationPreviewBarProps {
    submitting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

const TranslationPreviewBar: React.FC<TranslationPreviewBarProps> = ({
    submitting,
    onCancel,
    onConfirm,
}) => {
    const { t } = useTranslation(['tickets', 'common']);

    return (
        <div className="flex-none p-2 bg-emerald-600/20 border-b border-emerald-500/30 flex items-center justify-between animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2 px-2">
                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{t('translation.previewTitle')}</span>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={onCancel} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-[10px] font-bold">
                    {t('common:button.cancel')}
                </button>
                <button onClick={onConfirm} disabled={submitting} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[10px] font-bold shadow-lg shadow-emerald-500/20">
                    {submitting ? t('translation.saving') : t('translation.confirmSave')}
                </button>
            </div>
        </div>
    );
};

export default TranslationPreviewBar;
