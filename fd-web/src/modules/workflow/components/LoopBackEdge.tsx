import React from 'react';
import { type EdgeProps } from '@xyflow/react';

/**
 * Custom edge component for backward/loop connections in LR layouts.
 * Routes the edge ABOVE the nodes instead of through them.
 *
 * Path: source (right side) → curve up → horizontal left → curve down → target (left side)
 */
const LoopBackEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  label,
  labelStyle,
}) => {
  // How far above the source/target to route the edge
  const gapY = 120;
  const topY = Math.min(sourceY, targetY) - gapY;

  // Horizontal control-point offset for smooth entry/exit
  const cpOffset = 60;

  // Mid-point for the horizontal run
  const midX = (sourceX + targetX) / 2;

  // Build a smooth cubic-bezier path:
  //   1. Exit source rightward, curve up to topY
  //   2. Horizontal run at topY
  //   3. Curve down to enter target leftward
  const path = [
    `M ${sourceX} ${sourceY}`,
    // curve right + up from source to the midpoint at topY
    `C ${sourceX + cpOffset} ${sourceY}, ${sourceX + cpOffset} ${topY}, ${midX} ${topY}`,
    // curve left + down from midpoint at topY to target
    `C ${targetX - cpOffset} ${topY}, ${targetX - cpOffset} ${targetY}, ${targetX} ${targetY}`,
  ].join(' ');

  // Label position at the top of the arc
  const labelX = midX;
  const labelY = topY - 6;

  return (
    <g className="react-flow__edge">
      <path
        id={id}
        d={path}
        fill="none"
        style={style}
        className="react-flow__edge-path"
        markerEnd={markerEnd as string}
      />
      {/* Invisible wider path for easier interaction */}
      <path
        d={path}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        className="react-flow__edge-interaction"
      />
      {label && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="auto"
          style={labelStyle as React.CSSProperties}
          className="react-flow__edge-text"
        >
          {String(label)}
        </text>
      )}
    </g>
  );
};

export default React.memo(LoopBackEdge);
