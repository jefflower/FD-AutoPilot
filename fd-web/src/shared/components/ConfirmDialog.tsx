import React, { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
    /** 是否显示对话框 */
    open: boolean;
    /** 对话框标题 */
    title?: string;
    /** 对话框消息内容 */
    message: string;
    /** 确认按钮文本 */
    confirmText?: string;
    /** 取消按钮文本 */
    cancelText?: string;
    /** 确认回调 */
    onConfirm: () => void;
    /** 取消回调 */
    onCancel: () => void;
    /** 变体样式 */
    variant?: ConfirmDialogVariant;
}

const variantConfig: Record<ConfirmDialogVariant, {
    iconColor: string;
    iconBg: string;
    confirmBg: string;
    confirmHover: string;
    icon: React.ReactNode;
}> = {
    danger: {
        iconColor: 'text-red-400',
        iconBg: 'bg-red-500/10 border-red-500/20',
        confirmBg: 'bg-red-600',
        confirmHover: 'hover:bg-red-500',
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        ),
    },
    warning: {
        iconColor: 'text-amber-400',
        iconBg: 'bg-amber-500/10 border-amber-500/20',
        confirmBg: 'bg-amber-600',
        confirmHover: 'hover:bg-amber-500',
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
    info: {
        iconColor: 'text-blue-400',
        iconBg: 'bg-blue-500/10 border-blue-500/20',
        confirmBg: 'bg-blue-600',
        confirmHover: 'hover:bg-blue-500',
        icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
    variant = 'info',
}) => {
    const { t } = useTranslation('common');
    const config = variantConfig[variant];

    // ESC 键关闭
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            onCancel();
        }
    }, [onCancel]);

    useEffect(() => {
        if (open) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [open, handleKeyDown]);

    // Backdrop 点击关闭
    const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    }, [onCancel]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="w-full max-w-md mx-4 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Body */}
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        {/* Icon */}
                        <div className={`flex-shrink-0 w-10 h-10 rounded-full border flex items-center justify-center ${config.iconBg} ${config.iconColor}`}>
                            {config.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-slate-200 mb-1">
                                {title || t('confirmDialog.defaultTitle')}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {message}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 bg-white/5 border-t border-white/5">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
                    >
                        {cancelText || t('confirmDialog.defaultCancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${config.confirmBg} ${config.confirmHover}`}
                    >
                        {confirmText || t('confirmDialog.defaultConfirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
