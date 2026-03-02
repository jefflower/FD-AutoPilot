import React, { useRef, useState, useCallback, useEffect } from 'react';

interface ResizableSplitPaneProps {
  topContent: React.ReactNode;
  bottomContent: React.ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
}

const ResizableSplitPane: React.FC<ResizableSplitPaneProps> = ({
  topContent,
  bottomContent,
  defaultRatio = 0.4,
  minRatio = 0.2,
  maxRatio = 0.8,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(defaultRatio);
  const [ratio, setRatio] = useState(defaultRatio);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const rafRef = useRef<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let newRatio = y / rect.height;
        newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio));
        ratioRef.current = newRatio;
        setRatio(newRatio);
        rafRef.current = null;
      });
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [minRatio, maxRatio]);

  const topPercent = `${ratio * 100}%`;
  const bottomPercent = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full ${className}`}
      style={{ userSelect: isDragging ? 'none' : undefined }}
    >
      {/* Top pane */}
      <div className="overflow-hidden" style={{ height: topPercent }}>
        {topContent}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`h-1.5 flex-shrink-0 cursor-row-resize transition-colors ${
          isDragging
            ? 'bg-indigo-500/60'
            : 'bg-slate-700/30 hover:bg-indigo-500/50'
        }`}
      />

      {/* Bottom pane */}
      <div className="overflow-hidden" style={{ height: bottomPercent }}>
        {bottomContent}
      </div>
    </div>
  );
};

export default ResizableSplitPane;
