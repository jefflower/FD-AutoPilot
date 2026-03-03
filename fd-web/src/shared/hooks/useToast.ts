import { useContext } from 'react';
import { ToastContext } from '../components/ToastProvider';

/**
 * Toast 通知 Hook
 *
 * 用法：
 * ```ts
 * const { toast } = useToast();
 * toast('success', '保存成功');
 * toast('error', '操作失败', 5000);
 * ```
 */
export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
