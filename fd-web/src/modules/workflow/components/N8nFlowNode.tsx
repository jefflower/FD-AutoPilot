import React from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { getNodeTypeShortName, getParameterSummary } from '../utils/n8nToReactFlow';

// N8nNode 数据类型
type N8nNodeData = {
  label: string;
  nodeType: string;
  parameters: Record<string, unknown>;
  color: string;
  icon: string;
  /** 从外部注入的 output handle 数量 */
  outputCount?: number;
  /** 从外部注入的 input handle 数量 */
  inputCount?: number;
};

type N8nFlowNodeType = Node<N8nNodeData, 'n8nNode'>;

const N8nFlowNode: React.FC<NodeProps<N8nFlowNodeType>> = ({ data }) => {
  const {
    label,
    nodeType,
    parameters,
    color,
    icon,
    outputCount = 1,
    inputCount = 1,
  } = data;

  const shortType = getNodeTypeShortName(nodeType);
  const summary = getParameterSummary(parameters);

  // 判断是否为触发器节点（没有 input handle）
  const isTrigger =
    nodeType.includes('Trigger') ||
    nodeType.includes('trigger') ||
    nodeType.includes('webhook');

  return (
    <div
      className="relative bg-slate-800/90 border border-slate-600/50 rounded-lg shadow-lg min-w-[200px] max-w-[240px] overflow-hidden"
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      {/* Input handles */}
      {!isTrigger &&
        Array.from({ length: inputCount }, (_, i) => (
          <Handle
            key={`input-${i}`}
            type="target"
            position={Position.Left}
            id={`input-${i}`}
            className="!w-2.5 !h-2.5 !bg-slate-400 !border-slate-600"
            style={{
              top: inputCount === 1 ? '50%' : `${((i + 1) / (inputCount + 1)) * 100}%`,
            }}
          />
        ))}

      {/* 节点内容 */}
      <div className="px-3 py-2.5">
        {/* 名称行 */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-sm flex-shrink-0">{icon}</span>
          <span className="text-xs font-semibold text-slate-200 truncate leading-tight">
            {label}
          </span>
        </div>

        {/* 类型标签 */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: `${color}20`,
              color: color,
            }}
          >
            {shortType}
          </span>
        </div>

        {/* 参数摘要 */}
        {summary && (
          <p className="text-[10px] text-slate-500 truncate mt-1" title={summary}>
            {summary}
          </p>
        )}
      </div>

      {/* Output handles */}
      {Array.from({ length: outputCount }, (_, i) => (
        <Handle
          key={`output-${i}`}
          type="source"
          position={Position.Right}
          id={`output-${i}`}
          className="!w-2.5 !h-2.5 !bg-slate-400 !border-slate-600"
          style={{
            top: outputCount === 1 ? '50%' : `${((i + 1) / (outputCount + 1)) * 100}%`,
          }}
        />
      ))}
    </div>
  );
};

export default React.memo(N8nFlowNode);
