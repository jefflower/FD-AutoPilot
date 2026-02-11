import { Component, ErrorInfo, ReactNode } from 'react';
import i18n from '../../i18n/config';

interface ErrorBoundaryProps {
    children: ReactNode;
    /** 可选的自定义 fallback 渲染 */
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * 标准 React ErrorBoundary 类组件
 *
 * 捕获子组件渲染错误，显示友好的错误提示 + "重试"按钮。
 * 支持 i18n（通过直接调用 i18n.t 而非 useTranslation hook，因为这是类组件）。
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const t = (key: string) => i18n.t(key, { ns: 'common' } as any) as string;

            return (
                <div className="flex-1 flex items-center justify-center p-8">
                    <div className="text-center max-w-md">
                        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h2 className="text-lg font-semibold text-slate-200 mb-2">
                            {t('errorBoundary.title')}
                        </h2>
                        <p className="text-sm text-slate-400 mb-6">
                            {t('errorBoundary.description')}
                        </p>
                        {this.state.error && (
                            <details className="mb-6 text-left">
                                <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400 transition-colors">
                                    {t('errorBoundary.details')}
                                </summary>
                                <pre className="mt-2 p-3 rounded-lg bg-slate-800/50 border border-white/5 text-xs text-red-300 overflow-auto max-h-32">
                                    {this.state.error.message}
                                </pre>
                            </details>
                        )}
                        <button
                            onClick={this.handleRetry}
                            className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                        >
                            {t('errorBoundary.retry')}
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
