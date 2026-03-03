import React from 'react';

interface LogPanelProps {
    logs: string[];
    maxVisible?: number;
}

const LogPanel: React.FC<LogPanelProps> = ({ logs, maxVisible = 3 }) => {
    if (logs.length === 0) return null;

    return (
        <div className="h-16 bg-black/40 border-t border-white/10 overflow-y-auto p-2 text-[9px] font-mono text-slate-500">
            {logs.slice(-maxVisible).map((log, i) => (
                <div key={i} className="truncate">{log}</div>
            ))}
        </div>
    );
};

export default LogPanel;
