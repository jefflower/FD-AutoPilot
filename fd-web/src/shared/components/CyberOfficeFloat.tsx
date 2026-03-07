import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import { agentApi } from '../services/api';
import { useServerEvent } from '../context/ServerEventsContext';
import { useAgentContext } from '../agents/AgentContext';
import { usePollingControl } from '../hooks/usePollingControl';
import { useIsMobile } from '../hooks/useMediaQuery';
import CyberOfficePopover from './CyberOfficePopover';

interface CyberOfficeFloatProps {
  onNavigateToOffice: () => void;
}

const CyberOfficeFloat: React.FC<CyberOfficeFloatProps> = ({ onNavigateToOffice }) => {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [executingCount, setExecutingCount] = useState(0);
  const { canExecute, startupReady } = useAgentContext();
  const isDetecting = canExecute && !startupReady;
  const { pollingPaused } = usePollingControl();
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ─── Drag state ───
  const [pos, setPos] = useState({ right: 24, bottom: 24 }); // px
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startRight: 0, startBottom: 0, moved: false });

  // Fetch running executions count
  const fetchExecutingCount = useCallback(async () => {
    try {
      const running = await agentApi.getRunningExecutions();
      setExecutingCount(running.length);
    } catch {
      // Silently ignore errors
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchExecutingCount();
  }, [fetchExecutingCount]);

  // Auto refresh every 30s（pollingPaused 时停止）
  useEffect(() => {
    if (pollingPaused) return;
    const timer = setInterval(fetchExecutingCount, 30_000);
    return () => clearInterval(timer);
  }, [fetchExecutingCount, pollingPaused]);

  // SSE: instant refresh on execution events
  const fetchRef = useRef(fetchExecutingCount);
  fetchRef.current = fetchExecutingCount;

  useServerEvent('agent-execution-started', useCallback(() => {
    fetchRef.current();
  }, []));

  useServerEvent('agent-execution-completed', useCallback(() => {
    fetchRef.current();
  }, []));

  // ─── Drag handlers ───
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startRight: pos.right, startBottom: pos.bottom, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // dead-zone
    d.moved = true;
    const newRight = Math.max(8, Math.min(window.innerWidth - 64, d.startRight - dx));
    const newBottom = Math.max(8, Math.min(window.innerHeight - 64, d.startBottom - dy));
    setPos({ right: newRight, bottom: newBottom });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const wasDrag = dragRef.current.moved;
    dragRef.current.dragging = false;
    if (!wasDrag) {
      setIsOpen(prev => !prev);
    }
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  // Click outside to close popover
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 移动端隐藏浮球（底部导航栏已有 AI Dashboard 入口）
  if (isMobile) return null;

  return (
    <>
      {/* Float button */}
      <button
        ref={buttonRef}
        className={`fixed z-50 w-14 h-14 rounded-full bg-slate-800 border-2 shadow-lg flex items-center justify-center hover:scale-110 transition-transform group cursor-grab active:cursor-grabbing touch-none ${
          isDetecting
            ? 'border-amber-500/50 shadow-amber-500/20 animate-pulse'
            : 'border-blue-500/50 shadow-blue-500/20'
        }`}
        style={{ right: pos.right, bottom: pos.bottom }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={isDetecting ? '\u6b63\u5728\u68c0\u6d4b\u73af\u5883...' : '\u8d5b\u535a\u529e\u516c\u5ba4'}
      >
        {isDetecting ? (
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <Building2 className="w-6 h-6 text-blue-400 group-hover:text-blue-300 transition-colors" />
        )}
        {executingCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-xs text-white rounded-full flex items-center justify-center animate-pulse font-medium">
            {executingCount}
          </span>
        )}
      </button>

      {/* Popover with transition */}
      <div
        ref={popoverRef}
        className={`fixed z-50 transition-all duration-200 ease-out ${
          isOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
        style={{ right: pos.right, bottom: pos.bottom + 72 }}
      >
        {isOpen && (
          <CyberOfficePopover
            onClose={() => setIsOpen(false)}
            onNavigateToOffice={() => {
              setIsOpen(false);
              onNavigateToOffice();
            }}
          />
        )}
      </div>
    </>
  );
};

export default CyberOfficeFloat;
