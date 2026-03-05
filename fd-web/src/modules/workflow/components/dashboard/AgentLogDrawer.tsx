import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import ExecutionLogZone from './ExecutionLogZone';

interface AgentLogDrawerProps {
  agentCode: string | null;
  agentName?: string;
  onClose: () => void;
  refreshTrigger: number;
}

const AgentLogDrawer: React.FC<AgentLogDrawerProps> = ({
  agentCode,
  agentName,
  onClose,
  refreshTrigger,
}) => {
  const { t } = useTranslation('common');
  const isOpen = agentCode !== null;

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* 遮罩层 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* 面板 */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[480px] xl:w-[560px] bg-slate-900 border-l border-slate-700/50 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white truncate">
              {agentName || agentCode}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('aiDashboard.executionLog.title', '执行日志')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors ml-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区：复用 ExecutionLogZone */}
        <div className="flex-1 flex flex-col overflow-hidden px-5 py-3">
          {isOpen && (
            <ExecutionLogZone
              definitions={[]}
              selectedAgent={agentCode}
              refreshTrigger={refreshTrigger}
              defaultTab="local"
              singleAgentMode
            />
          )}
        </div>
      </div>
    </>
  );
};

export default AgentLogDrawer;
