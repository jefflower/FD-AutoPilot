import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import { agentApi } from '../services/api';
import { useServerEvent } from '../context/ServerEventsContext';
import CyberOfficePopover from './CyberOfficePopover';

interface CyberOfficeFloatProps {
  onNavigateToOffice: () => void;
}

const CyberOfficeFloat: React.FC<CyberOfficeFloatProps> = ({ onNavigateToOffice }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [executingCount, setExecutingCount] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  // Auto refresh every 30s
  useEffect(() => {
    const timer = setInterval(fetchExecutingCount, 30_000);
    return () => clearInterval(timer);
  }, [fetchExecutingCount]);

  // SSE: instant refresh on execution events
  const fetchRef = useRef(fetchExecutingCount);
  fetchRef.current = fetchExecutingCount;

  useServerEvent('agent-execution-started', useCallback(() => {
    fetchRef.current();
  }, []));

  useServerEvent('agent-execution-completed', useCallback(() => {
    fetchRef.current();
  }, []));

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

  return (
    <>
      {/* Float button */}
      <button
        ref={buttonRef}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-slate-800 border-2 border-blue-500/50 shadow-lg shadow-blue-500/20 flex items-center justify-center hover:scale-110 transition-transform group"
        onClick={() => setIsOpen(!isOpen)}
        title={'\u8d5b\u535a\u529e\u516c\u5ba4'}
      >
        <Building2 className="w-6 h-6 text-blue-400 group-hover:text-blue-300 transition-colors" />
        {executingCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 text-xs text-white rounded-full flex items-center justify-center animate-pulse font-medium">
            {executingCount}
          </span>
        )}
      </button>

      {/* Popover with transition */}
      <div
        ref={popoverRef}
        className={`fixed bottom-24 right-6 z-50 transition-all duration-200 ease-out ${
          isOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
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
