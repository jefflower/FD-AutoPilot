import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
}

interface ToastProps {
    item: ToastItem;
    onClose: (id: string) => void;
}

const iconMap: Record<ToastType, React.ReactNode> = {
    success: (
        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
    ),
    error: (
        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
    ),
    warning: (
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
    ),
    info: (
        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
};

const bgMap: Record<ToastType, string> = {
    success: 'border-green-500/30 bg-green-500/10',
    error: 'border-red-500/30 bg-red-500/10',
    warning: 'border-amber-500/30 bg-amber-500/10',
    info: 'border-blue-500/30 bg-blue-500/10',
};

const Toast: React.FC<ToastProps> = ({ item, onClose }) => {
    const [visible, setVisible] = useState(false);
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        // 入场动画
        const enterTimer = requestAnimationFrame(() => setVisible(true));

        // 自动消失
        const duration = item.duration ?? 3000;
        const exitTimer = setTimeout(() => {
            setExiting(true);
            setTimeout(() => onClose(item.id), 300);
        }, duration);

        return () => {
            cancelAnimationFrame(enterTimer);
            clearTimeout(exitTimer);
        };
    }, [item.id, item.duration, onClose]);

    const handleClose = () => {
        setExiting(true);
        setTimeout(() => onClose(item.id), 300);
    };

    return (
        <div
            className={`
                flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-md shadow-lg
                transition-all duration-300 ease-out max-w-sm
                ${bgMap[item.type]}
                ${visible && !exiting ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
            `}
        >
            <div className="flex-shrink-0">{iconMap[item.type]}</div>
            <p className="text-sm text-slate-200 flex-1 break-words">{item.message}</p>
            <button
                onClick={handleClose}
                className="flex-shrink-0 text-slate-400 hover:text-slate-200 transition-colors"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
};

export default Toast;
