import React, { createContext, useCallback, useState } from 'react';
import Toast, { ToastItem, ToastType } from './Toast';

const MAX_TOASTS = 3;

export interface ToastContextType {
    toast: (type: ToastType, message: string, duration?: number) => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);

let globalIdCounter = 0;

const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const addToast = useCallback((type: ToastType, message: string, duration?: number) => {
        const id = `toast-${++globalIdCounter}-${Date.now()}`;
        const newToast: ToastItem = { id, type, message, duration };

        setToasts(prev => {
            const next = [...prev, newToast];
            // 超过最大数量时移除最早的
            if (next.length > MAX_TOASTS) {
                return next.slice(next.length - MAX_TOASTS);
            }
            return next;
        });
    }, []);

    return (
        <ToastContext.Provider value={{ toast: addToast }}>
            {children}
            {/* Toast 容器 - 固定在右上角 */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
                {toasts.map(item => (
                    <div key={item.id} className="pointer-events-auto">
                        <Toast item={item} onClose={removeToast} />
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export default ToastProvider;
