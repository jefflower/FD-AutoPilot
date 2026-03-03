import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentDefinition, AgentInstance, AgentStats, AgentExecutionLog } from '../../../../shared/types/server';
import AgentStatusCard from './AgentStatusCard';

interface ModuleAgentGridProps {
  definitions: AgentDefinition[];
  instances: AgentInstance[];
  stats: AgentStats[];
  onlineClientIds: Set<string>;
  selectedAgent: string | null;
  onSelectAgent: (code: string) => void;
  onToggleAgent: (id: number) => void;
  /** 当前正在执行中的任务列表 */
  runningExecutions?: AgentExecutionLog[];
}

type ModuleCode = 'all' | 'ticket' | 'admin' | 'workflow' | 'ungrouped';

const MODULE_CODES: ModuleCode[] = ['all', 'ticket', 'admin', 'workflow', 'ungrouped'];

const ModuleAgentGrid: React.FC<ModuleAgentGridProps> = ({
  definitions,
  instances,
  stats,
  onlineClientIds,
  selectedAgent,
  onSelectAgent,
  onToggleAgent,
  runningExecutions = [],
}) => {
  const { t } = useTranslation('common');
  const [activeModule, setActiveModule] = useState<ModuleCode>('all');

  const filteredDefinitions = useMemo(() => {
    if (activeModule === 'all') return definitions;
    if (activeModule === 'ungrouped') {
      return definitions.filter(d => !d.groupCode);
    }
    return definitions.filter(d => d.groupCode === activeModule);
  }, [definitions, activeModule]);

  const getInstancesForAgent = (code: string) =>
    instances.filter(i => i.agentCode === code);

  const getStatsForAgent = (code: string) =>
    stats.find(s => s.agentCode === code);

  // 统计每个 Agent 当前正在执行的任务数
  const executingCountMap = useMemo(() => {
    const map = new Map<string, number>();
    runningExecutions.forEach(exec => {
      map.set(exec.agentCode, (map.get(exec.agentCode) || 0) + 1);
    });
    return map;
  }, [runningExecutions]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Module filter tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 mb-3 flex-wrap">
        {MODULE_CODES.map(code => (
          <button
            key={code}
            onClick={() => setActiveModule(code)}
            className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
              activeModule === code
                ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border-slate-700/50'
            }`}
          >
            {t(`aiDashboard.moduleFilter.${code}`)}
          </button>
        ))}
      </div>

      {/* Agent grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredDefinitions.map(def => (
            <AgentStatusCard
              key={def.id}
              definition={def}
              instances={getInstancesForAgent(def.code)}
              onlineClientIds={onlineClientIds}
              stats={getStatsForAgent(def.code)}
              isSelected={selectedAgent === def.code}
              onSelect={onSelectAgent}
              onToggle={onToggleAgent}
              executingCount={executingCountMap.get(def.code) || 0}
            />
          ))}
        </div>
        {filteredDefinitions.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-8">
            {t('agent.noAgentsInModule')}
          </div>
        )}
      </div>
    </div>
  );
};

export default ModuleAgentGrid;
