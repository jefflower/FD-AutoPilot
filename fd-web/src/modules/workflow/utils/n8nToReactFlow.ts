import { type Node, type Edge, MarkerType } from '@xyflow/react';
import * as dagre from '@dagrejs/dagre';

// n8n 节点类型颜色映射
const NODE_COLORS: Record<string, string> = {
  'n8n-nodes-base.httpRequest': '#3b82f6',       // blue
  'n8n-nodes-base.webhook': '#8b5cf6',           // purple
  'n8n-nodes-base.if': '#eab308',                // yellow
  'n8n-nodes-base.set': '#22c55e',               // green
  'n8n-nodes-base.code': '#a855f7',              // purple
  'n8n-nodes-base.scheduleTrigger': '#f97316',   // orange
  'n8n-nodes-base.noOp': '#6b7280',              // gray
  'n8n-nodes-base.splitInBatches': '#14b8a6',    // teal
  'n8n-nodes-base.splitOut': '#06b6d4',          // cyan
  'n8n-nodes-base.respondToWebhook': '#8b5cf6',  // purple
  'n8n-nodes-base.stickyNote': '#fbbf24',        // amber
  default: '#6366f1',                             // indigo
};

// n8n 节点类型图标 emoji 映射
const NODE_ICONS: Record<string, string> = {
  'n8n-nodes-base.httpRequest': '🌐',
  'n8n-nodes-base.webhook': '🔔',
  'n8n-nodes-base.if': '🔀',
  'n8n-nodes-base.set': '📝',
  'n8n-nodes-base.code': '💻',
  'n8n-nodes-base.scheduleTrigger': '⏰',
  'n8n-nodes-base.noOp': '⏸',
  'n8n-nodes-base.splitInBatches': '🔄',
  'n8n-nodes-base.splitOut': '📤',
  'n8n-nodes-base.respondToWebhook': '📨',
  'n8n-nodes-base.stickyNote': '📌',
};

// ============ n8n JSON 类型 ============

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  position: [number, number];
  parameters?: Record<string, unknown>;
  typeVersion?: number;
  webhookId?: string;
}

export interface N8nConnection {
  node: string;
  type: string;
  index: number;
}

export interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  connections: Record<string, { main?: N8nConnection[][] }>;
  settings?: Record<string, unknown>;
  tags?: Array<{ name: string }>;
}

// ============ 转换函数 ============

export function n8nToReactFlow(workflow: N8nWorkflow): { nodes: Node[]; edges: Edge[] } {
  // 过滤掉 stickyNote 类型节点（仅用于 n8n 编辑器中的注释）
  const filteredNodes = workflow.nodes.filter(
    n => n.type !== 'n8n-nodes-base.stickyNote',
  );

  // 1. 转换节点
  const nodes: Node[] = filteredNodes.map((n8nNode) => ({
    id: n8nNode.name, // n8n 用 name 作为连接标识
    type: 'n8nNode',
    position: { x: n8nNode.position[0], y: n8nNode.position[1] },
    data: {
      label: n8nNode.name,
      nodeType: n8nNode.type,
      parameters: n8nNode.parameters || {},
      color: NODE_COLORS[n8nNode.type] || NODE_COLORS.default,
      icon: NODE_ICONS[n8nNode.type] || '⚙️',
    },
  }));

  // 2. 转换边（connections）
  const edges: Edge[] = [];
  const nodeNameSet = new Set(filteredNodes.map(n => n.name));

  // Build a map of node name → color for edge coloring
  const nodeColorMap = new Map<string, string>();
  filteredNodes.forEach(n => {
    nodeColorMap.set(n.name, NODE_COLORS[n.type] || NODE_COLORS.default);
  });

  Object.entries(workflow.connections).forEach(([sourceName, conn]) => {
    if (!nodeNameSet.has(sourceName)) return; // 跳过已过滤的节点

    const sourceColor = nodeColorMap.get(sourceName) || '#64748b';
    const outputs = conn.main || [];
    outputs.forEach((targets, outputIndex) => {
      targets.forEach((target) => {
        if (!nodeNameSet.has(target.node)) return; // 跳过已过滤的目标节点

        edges.push({
          id: `${sourceName}-o${outputIndex}-${target.node}-i${target.index}`,
          source: sourceName,
          target: target.node,
          sourceHandle: `output-${outputIndex}`,
          targetHandle: `input-${target.index}`,
          // Use default bezier for smooth curves; handle offset (42%/58%) creates natural separation
          animated: true,
          style: { stroke: sourceColor, strokeWidth: 2, opacity: 0.7 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: sourceColor,
          },
          label: outputs.length > 1 ? `#${outputIndex}` : undefined,
          labelStyle: { fill: '#94a3b8', fontSize: 10 },
        });
      });
    });
  });

  // 3. 如果所有节点 position 都是 [0,0]，使用 dagre 自动布局
  const allZero = nodes.every(n => n.position.x === 0 && n.position.y === 0);
  if (allZero) {
    const result = autoLayout(nodes, edges);
    return { nodes: result.nodes, edges: markLoopBackEdges(result.nodes, result.edges) };
  }

  return { nodes, edges: markLoopBackEdges(nodes, edges) };
}

function autoLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 150 });

  const nodeWidth = 220;
  const nodeHeight = 80;

  nodes.forEach(node => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  edges.forEach(edge => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map(node => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - nodeWidth / 2,
        y: pos.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ============ 工具函数 ============

/** 获取节点类型的简短名称 */
export function getNodeTypeShortName(fullType: string): string {
  const parts = fullType.split('.');
  return parts[parts.length - 1] || fullType;
}

/** 计算节点需要的 output handle 数量 */
export function getOutputCount(
  nodeName: string,
  connections: Record<string, { main?: N8nConnection[][] }>,
): number {
  const conn = connections[nodeName];
  if (!conn?.main) return 1;
  return Math.max(conn.main.length, 1);
}

/** 计算节点需要的 input handle 数量 */
export function getInputCount(
  nodeName: string,
  connections: Record<string, { main?: N8nConnection[][] }>,
): number {
  let maxIndex = 0;
  Object.values(connections).forEach(conn => {
    const outputs = conn.main || [];
    outputs.forEach(targets => {
      targets.forEach(target => {
        if (target.node === nodeName) {
          maxIndex = Math.max(maxIndex, target.index + 1);
        }
      });
    });
  });
  return Math.max(maxIndex, 1);
}

/**
 * Detect backward edges (source.x >= target.x in LR layout) and mark them as 'loopBack' type
 * so they route above the nodes instead of through them.
 */
function markLoopBackEdges(nodes: Node[], edges: Edge[]): Edge[] {
  const posMap = new Map<string, { x: number; y: number }>();
  nodes.forEach(n => posMap.set(n.id, n.position));

  return edges.map(edge => {
    const srcPos = posMap.get(edge.source);
    const tgtPos = posMap.get(edge.target);
    if (srcPos && tgtPos && srcPos.x >= tgtPos.x) {
      // This is a backward/loop edge — use custom loopBack edge type
      return {
        ...edge,
        type: 'loopBack',
        animated: true,
        // Use dashed style for loop-back edges to visually distinguish them
        style: { ...edge.style, strokeDasharray: '6 3' },
      };
    }
    return edge;
  });
}

/** 提取参数摘要 */
export function getParameterSummary(params: Record<string, unknown>): string {
  const summaryParts: string[] = [];

  if (params.url) summaryParts.push(`URL: ${String(params.url).replace(/^.*:\/\/[^/]+/, '')}`);
  if (params.method) summaryParts.push(`${String(params.method)}`);
  if (params.path) summaryParts.push(`Path: ${String(params.path)}`);
  if (params.httpMethod) summaryParts.push(`${String(params.httpMethod)}`);
  if (params.rule) summaryParts.push('Scheduled');
  if (params.batchSize) summaryParts.push(`Batch: ${String(params.batchSize)}`);
  if (params.fieldToSplitOut) summaryParts.push(`Field: ${String(params.fieldToSplitOut)}`);

  return summaryParts.join(' | ') || '';
}
