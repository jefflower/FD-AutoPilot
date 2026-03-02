import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import N8nFlowNode from './N8nFlowNode';
import {
  n8nToReactFlow,
  getOutputCount,
  getInputCount,
  type N8nWorkflow,
} from '../utils/n8nToReactFlow';

interface WorkflowVisualizerProps {
  workflowJson: string | null;
  className?: string;
}

// 注册自定义节点类型（必须在组件外部定义，避免无限重渲染）
const nodeTypes = { n8nNode: N8nFlowNode };

export default function WorkflowVisualizer({ workflowJson, className }: WorkflowVisualizerProps) {
  const { nodes, edges } = useMemo(() => {
    if (!workflowJson) return { nodes: [], edges: [] };
    try {
      const parsed: N8nWorkflow = JSON.parse(workflowJson);
      if (!parsed.nodes || !parsed.connections) return { nodes: [], edges: [] };

      const result = n8nToReactFlow(parsed);

      // 为每个节点注入 outputCount 和 inputCount
      const nodesWithHandles: Node[] = result.nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          outputCount: getOutputCount(node.id, parsed.connections),
          inputCount: getInputCount(node.id, parsed.connections),
        },
      }));

      return { nodes: nodesWithHandles, edges: result.edges };
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [workflowJson]);

  if (!workflowJson || nodes.length === 0) {
    return (
      <div className={`${className || ''} flex items-center justify-center text-slate-500 text-sm`}>
        <span>暂无工作流数据</span>
      </div>
    );
  }

  return (
    <div className={`${className || ''} w-full h-full`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="#334155" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-slate-800 !border-slate-700 !shadow-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!text-slate-400 [&>button:hover]:!bg-slate-700"
        />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          style={{ background: '#1e293b' }}
          nodeColor={(node) => {
            return (node.data as Record<string, unknown>)?.color as string || '#6366f1';
          }}
          maskColor="rgba(15, 23, 42, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
