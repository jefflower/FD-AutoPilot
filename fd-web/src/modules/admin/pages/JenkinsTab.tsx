import { useState, useCallback } from 'react';
import { Hammer, ExternalLink, RefreshCw } from 'lucide-react';

const JENKINS_URL = 'http://47.110.152.25:9999/';

export default function JenkinsTab() {
    const [iframeKey, setIframeKey] = useState(0);
    const [loading, setLoading] = useState(true);

    const handleReload = useCallback(() => {
        setLoading(true);
        setIframeKey(prev => prev + 1);
    }, []);

    return (
        <div className="flex flex-col w-full h-full bg-slate-950">
            {/* 顶部工具栏 */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
                <div className="flex items-center gap-2 text-slate-300">
                    <Hammer className="w-4 h-4 text-orange-400" />
                    <span className="text-sm font-medium">Jenkins CI/CD</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleReload}
                        className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                        title="刷新"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <a
                        href={JENKINS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        新窗口打开
                    </a>
                </div>
            </div>

            {/* iframe 容器 */}
            <div className="flex-1 relative">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-10">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                            <span className="text-sm text-slate-400">正在加载 Jenkins...</span>
                        </div>
                    </div>
                )}
                <iframe
                    key={iframeKey}
                    src={JENKINS_URL}
                    className="w-full h-full border-0"
                    title="Jenkins CI/CD"
                    onLoad={() => setLoading(false)}
                />
            </div>
        </div>
    );
}
