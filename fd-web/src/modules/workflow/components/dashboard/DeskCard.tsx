import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Monitor,
  MonitorOff,
  Coffee,
  Zap,
} from 'lucide-react';
import type { AgentDefinition, AgentInstance, AgentStats, AgentExecutionLog } from '../../../../shared/types/server';

interface DeskCardProps {
  definition: AgentDefinition;
  instances: AgentInstance[];
  onlineClientIds: Set<string>;
  stats?: AgentStats;
  executingCount: number;
  currentExecution?: AgentExecutionLog;
  onToggle: (id: number) => void;
  onClick: () => void;
  compact?: boolean;
  /** 该 Agent 是否正在轮询任务（autoStart 或手动启动） */
  isPolling?: boolean;
}

type DeskStatus = 'executing' | 'standby' | 'enabled' | 'disabled';

function getDeskStatus(
  definition: AgentDefinition,
  executingCount: number,
  isPolling: boolean,
): DeskStatus {
  if (!definition.enabled) return 'disabled';
  if (executingCount > 0) return 'executing';
  if (isPolling) return 'standby';   // 正在轮询 = 坐在工位上待命
  return 'enabled';                  // 已启用但未轮询 = 在休息
}

function formatElapsed(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s`;
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m${Math.floor((elapsed % 60000) / 1000)}s`;
  return `${Math.floor(elapsed / 3600000)}h${Math.floor((elapsed % 3600000) / 60000)}m`;
}

/* ---------- SVG Filter Defs (rendered once) ---------- */
const CyberSvgDefs: React.FC = () => (
  <svg width="0" height="0" className="absolute">
    <defs>
      <filter id="cyber-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed="1" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
    </defs>
  </svg>
);

/* ---------- Workstation SVG Scenes ---------- */

/** Executing: full-power hacker terminal with triple screens */
const WorkstationExecuting: React.FC = () => (
  <div className="relative w-full h-24 flex items-end justify-center">
    <svg viewBox="0 0 160 96" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Desk surface line - glowing */}
      <line x1="10" y1="88" x2="150" y2="88" stroke="#06B6D4" strokeWidth="2" opacity="0.5">
        <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2s" repeatCount="indefinite" />
      </line>

      {/* Left sub-screen (rotated -12deg) */}
      <g transform="translate(28, 38) rotate(-12, 19, 14)">
        <rect x="0" y="0" width="38" height="28" rx="2" fill="#0F172A" stroke="#06B6D4" strokeWidth="0.8" opacity="0.7" />
        {/* Data bars - horizontal bars with pulse */}
        <rect x="4" y="5" width="18" height="2.5" rx="1" fill="#06B6D4" opacity="0.6">
          <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect x="4" y="10" width="26" height="2.5" rx="1" fill="#A855F7" opacity="0.5">
          <animate attributeName="opacity" values="0.5;0.8;0.5" dur="1.5s" repeatCount="indefinite" begin="0.3s" />
        </rect>
        <rect x="4" y="15" width="14" height="2.5" rx="1" fill="#06B6D4" opacity="0.6">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" begin="0.6s" />
        </rect>
        <rect x="4" y="20" width="22" height="2.5" rx="1" fill="#A855F7" opacity="0.4">
          <animate attributeName="opacity" values="0.4;0.7;0.4" dur="1.5s" repeatCount="indefinite" begin="0.9s" />
        </rect>
        {/* Screen stand */}
        <rect x="16" y="28" width="6" height="3" fill="#334155" />
      </g>

      {/* Main center screen */}
      <g transform="translate(56, 28)">
        <rect x="0" y="0" width="48" height="36" rx="2" fill="#0F172A" stroke="#06B6D4" strokeWidth="1" />
        {/* Code lines scrolling */}
        <line x1="4" y1="6" x2="38" y2="6" stroke="#06B6D4" strokeWidth="1" strokeDasharray="8 4" opacity="0.7">
          <animate attributeName="stroke-dashoffset" values="40;0" dur="2s" repeatCount="indefinite" />
        </line>
        <line x1="4" y1="11" x2="32" y2="11" stroke="#60A5FA" strokeWidth="1" strokeDasharray="6 6" opacity="0.5">
          <animate attributeName="stroke-dashoffset" values="40;0" dur="2.3s" repeatCount="indefinite" />
        </line>
        <line x1="4" y1="16" x2="42" y2="16" stroke="#A855F7" strokeWidth="1" strokeDasharray="10 3" opacity="0.6">
          <animate attributeName="stroke-dashoffset" values="40;0" dur="1.8s" repeatCount="indefinite" />
        </line>
        <line x1="4" y1="21" x2="28" y2="21" stroke="#06B6D4" strokeWidth="1" strokeDasharray="5 5" opacity="0.5">
          <animate attributeName="stroke-dashoffset" values="40;0" dur="2.5s" repeatCount="indefinite" />
        </line>
        <line x1="4" y1="26" x2="36" y2="26" stroke="#60A5FA" strokeWidth="1" strokeDasharray="7 4" opacity="0.4">
          <animate attributeName="stroke-dashoffset" values="40;0" dur="2.1s" repeatCount="indefinite" />
        </line>
        {/* Recording indicator - green dot top-left */}
        <circle cx="5" cy="2" r="1.5" fill="#34D399">
          <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
          <animate attributeName="r" values="1.2;1.8;1.2" dur="2s" repeatCount="indefinite" />
        </circle>
        {/* Scanline sweeping down */}
        <line x1="0" y1="0" x2="48" y2="0" stroke="#06B6D4" strokeWidth="1" opacity="0.3">
          <animate attributeName="y1" values="-2;38" dur="3s" repeatCount="indefinite" />
          <animate attributeName="y2" values="-2;38" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.4;0" dur="3s" repeatCount="indefinite" />
        </line>
        {/* Screen stand */}
        <rect x="20" y="36" width="8" height="4" fill="#334155" />
        <rect x="14" y="40" width="20" height="2" rx="1" fill="#334155" />
      </g>

      {/* Right sub-screen (rotated +12deg) */}
      <g transform="translate(112, 38) rotate(12, 19, 14)">
        <rect x="0" y="0" width="38" height="28" rx="2" fill="#0F172A" stroke="#06B6D4" strokeWidth="0.8" opacity="0.7" />
        {/* Circular progress ring */}
        <circle cx="19" cy="14" r="9" fill="none" stroke="#1E293B" strokeWidth="2" />
        <circle cx="19" cy="14" r="9" fill="none" stroke="#A855F7" strokeWidth="2"
          strokeDasharray="56.5" strokeDashoffset="14" strokeLinecap="round">
          <animate attributeName="strokeDashoffset" values="56.5;0;56.5" dur="4s" repeatCount="indefinite" />
        </circle>
        {/* Percentage text in center */}
        <text x="19" y="16" textAnchor="middle" fill="#A855F7" fontSize="6" fontFamily="monospace">
          75%
        </text>
        {/* Screen stand */}
        <rect x="16" y="28" width="6" height="3" fill="#334155" />
      </g>

      {/* Holographic projection cone above main screen */}
      <g opacity="0.4">
        <polygon points="68,28 92,28 98,12 62,12" fill="url(#holoGrad)" opacity="0.3">
          <animate attributeName="opacity" values="0.15;0.35;0.15" dur="3s" repeatCount="indefinite" />
        </polygon>
        {/* Floating diamond symbols */}
        <rect x="74" y="18" width="4" height="4" transform="rotate(45,76,20)" fill="#06B6D4" opacity="0.6">
          <animate attributeName="y" values="20;14;20" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite" />
        </rect>
        <rect x="82" y="16" width="3" height="3" transform="rotate(45,83.5,17.5)" fill="#A855F7" opacity="0.5">
          <animate attributeName="y" values="18;12;18" dur="3.5s" repeatCount="indefinite" begin="0.5s" />
          <animate attributeName="opacity" values="0.2;0.7;0.2" dur="3.5s" repeatCount="indefinite" begin="0.5s" />
        </rect>
        <rect x="78" y="14" width="2.5" height="2.5" transform="rotate(45,79.25,15.25)" fill="#60A5FA" opacity="0.4">
          <animate attributeName="y" values="16;10;16" dur="2.8s" repeatCount="indefinite" begin="1s" />
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2.8s" repeatCount="indefinite" begin="1s" />
        </rect>
      </g>

      {/* Keyboard - flat rectangle with 2x6 grid */}
      <g transform="translate(62, 78)">
        <rect x="0" y="0" width="36" height="8" rx="1" fill="#1E293B" stroke="#334155" strokeWidth="0.5" />
        {/* Key grid 2 rows x 6 cols */}
        {[0, 1].map(row =>
          [0, 1, 2, 3, 4, 5].map(col => (
            <rect
              key={`key-${row}-${col}`}
              x={2 + col * 5.5}
              y={1.5 + row * 3.5}
              width="4"
              height="2.5"
              rx="0.5"
              fill="#06B6D4"
              opacity="0.2"
            >
              <animate
                attributeName="opacity"
                values="0.15;0.7;0.15"
                dur="0.4s"
                repeatCount="indefinite"
                begin={`${(row * 6 + col) * 0.15}s`}
              />
            </rect>
          ))
        )}
      </g>

      {/* Person - simple circle head + shoulder arc */}
      <g transform="translate(128, 68)">
        <circle cx="8" cy="4" r="4" fill="none" stroke="#06B6D4" strokeWidth="1" opacity="0.7" />
        <path d="M0,16 Q8,8 16,16" fill="none" stroke="#06B6D4" strokeWidth="1" opacity="0.7" />
      </g>

      {/* Data particles rising from keyboard */}
      <circle cx="70" cy="76" r="1" fill="#06B6D4" opacity="0.6">
        <animate attributeName="cy" values="76;56" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;0" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="80" cy="76" r="0.8" fill="#A855F7" opacity="0.5">
        <animate attributeName="cy" values="76;52" dur="2.3s" repeatCount="indefinite" begin="0.5s" />
        <animate attributeName="opacity" values="0.7;0" dur="2.3s" repeatCount="indefinite" begin="0.5s" />
      </circle>
      <circle cx="90" cy="76" r="1.2" fill="#60A5FA" opacity="0.4">
        <animate attributeName="cy" values="76;54" dur="1.8s" repeatCount="indefinite" begin="1s" />
        <animate attributeName="opacity" values="0.6;0" dur="1.8s" repeatCount="indefinite" begin="1s" />
      </circle>
      <circle cx="85" cy="76" r="0.6" fill="#06B6D4" opacity="0.5">
        <animate attributeName="cy" values="76;50" dur="2.5s" repeatCount="indefinite" begin="0.3s" />
        <animate attributeName="opacity" values="0.7;0" dur="2.5s" repeatCount="indefinite" begin="0.3s" />
      </circle>

      {/* Gradient defs for holographic cone */}
      <defs>
        <linearGradient id="holoGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

/** Standby: calm monitoring station with heartbeat */
const WorkstationStandby: React.FC = () => (
  <div className="relative w-full h-24 flex items-end justify-center">
    <svg viewBox="0 0 160 96" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Desk surface line - subtle emerald */}
      <line x1="10" y1="88" x2="150" y2="88" stroke="#34D399" strokeWidth="1.5" opacity="0.3" />

      {/* Screen glow on desk surface */}
      <ellipse cx="80" cy="88" rx="30" ry="4" fill="#34D399" opacity="0.08">
        <animate attributeName="opacity" values="0.05;0.12;0.05" dur="4s" repeatCount="indefinite" />
      </ellipse>

      {/* Main screen - larger single monitor */}
      <g transform="translate(50, 24)">
        <rect x="0" y="0" width="60" height="42" rx="2" fill="#0F172A" stroke="#34D399" strokeWidth="0.8" opacity="0.8" />
        {/* Heartbeat / ECG waveform */}
        <path
          d="M4,22 L12,22 L15,22 L18,14 L21,30 L24,10 L27,26 L30,22 L38,22 L42,22 L45,18 L48,26 L51,22 L56,22"
          fill="none"
          stroke="#34D399"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="200"
          strokeDashoffset="200"
          opacity="0.7"
        >
          <animate attributeName="stroke-dashoffset" values="200;0" dur="4s" repeatCount="indefinite" />
        </path>
        {/* STANDBY text bottom-right */}
        <text x="42" y="38" fill="#34D399" fontSize="5" fontFamily="monospace" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0.2;0.7" dur="4s" repeatCount="indefinite" />
          STDBY
        </text>
        {/* Indicator light above screen */}
        <circle cx="30" cy="-4" r="2" fill="#34D399" opacity="0.5">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite" />
          <animate attributeName="r" values="1.5;2.5;1.5" dur="3s" repeatCount="indefinite" />
        </circle>
        {/* Screen stand */}
        <rect x="24" y="42" width="12" height="4" fill="#334155" />
        <rect x="18" y="46" width="24" height="2" rx="1" fill="#334155" />
      </g>

      {/* Person - sitting calmly, emerald stroke */}
      <g transform="translate(118, 66)">
        <circle cx="8" cy="4" r="4" fill="none" stroke="#34D399" strokeWidth="1" opacity="0.6" />
        <path d="M0,16 Q8,9 16,16" fill="none" stroke="#34D399" strokeWidth="1" opacity="0.6" />
      </g>

      {/* Keyboard - dim with occasional faint key glow */}
      <g transform="translate(62, 78)">
        <rect x="0" y="0" width="36" height="8" rx="1" fill="#1E293B" stroke="#334155" strokeWidth="0.5" opacity="0.5" />
        {/* Occasional single key glow */}
        <rect x="14" y="2.5" width="4" height="2.5" rx="0.5" fill="#34D399" opacity="0.15">
          <animate attributeName="opacity" values="0.05;0.3;0.05" dur="5s" repeatCount="indefinite" />
        </rect>
      </g>
    </svg>
  </div>
);

/** Enabled: resting corner with coffee and screensaver */
const WorkstationEnabled: React.FC = () => (
  <div className="relative w-full h-24 flex items-end justify-center opacity-80">
    <svg viewBox="0 0 160 96" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Desk surface line - subtle */}
      <line x1="10" y1="88" x2="150" y2="88" stroke="#FBBF24" strokeWidth="1" opacity="0.2" />

      {/* Main screen - screensaver mode */}
      <g transform="translate(50, 26)">
        <rect x="0" y="0" width="60" height="40" rx="2" fill="#0F172A" stroke="#FBBF24" strokeWidth="0.6" opacity="0.5" />
        {/* Screensaver concentric circles slowly drifting */}
        <g opacity="0.4">
          <circle cx="30" cy="20" r="6" fill="none" stroke="#FBBF24" strokeWidth="0.5">
            <animate attributeName="r" values="6;10;6" dur="12s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="12s" repeatCount="indefinite" />
          </circle>
          <circle cx="30" cy="20" r="10" fill="none" stroke="#FBBF24" strokeWidth="0.5">
            <animate attributeName="r" values="10;14;10" dur="12s" repeatCount="indefinite" begin="2s" />
            <animate attributeName="opacity" values="0.2;0.5;0.2" dur="12s" repeatCount="indefinite" begin="2s" />
          </circle>
          <circle cx="30" cy="20" r="14" fill="none" stroke="#FBBF24" strokeWidth="0.4">
            <animate attributeName="r" values="14;18;14" dur="12s" repeatCount="indefinite" begin="4s" />
            <animate attributeName="opacity" values="0.1;0.4;0.1" dur="12s" repeatCount="indefinite" begin="4s" />
          </circle>
        </g>
        {/* Screen stand */}
        <rect x="24" y="40" width="12" height="4" fill="#334155" opacity="0.6" />
        <rect x="18" y="44" width="24" height="2" rx="1" fill="#334155" opacity="0.6" />
      </g>

      {/* Coffee cup - trapezoid body + half circle handle + steam */}
      <g transform="translate(120, 64)">
        {/* Cup body (trapezoid) */}
        <path d="M2,0 L18,0 L16,18 L4,18 Z" fill="#1E293B" stroke="#FBBF24" strokeWidth="0.8" opacity="0.6" />
        {/* Handle (half circle arc) */}
        <path d="M18,4 Q26,9 18,14" fill="none" stroke="#FBBF24" strokeWidth="0.8" opacity="0.6" />
        {/* Steam curves */}
        <path d="M7,-2 Q5,-8 8,-12" fill="none" stroke="#FBBF24" strokeWidth="0.6" opacity="0.3">
          <animate attributeName="opacity" values="0;0.4;0" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="d" values="M7,-2 Q5,-8 8,-12;M7,-2 Q9,-10 6,-16;M7,-2 Q5,-8 8,-12" dur="2.5s" repeatCount="indefinite" />
        </path>
        <path d="M10,-2 Q12,-7 10,-11" fill="none" stroke="#FBBF24" strokeWidth="0.5" opacity="0.25">
          <animate attributeName="opacity" values="0;0.35;0" dur="2.5s" repeatCount="indefinite" begin="0.4s" />
          <animate attributeName="d" values="M10,-2 Q12,-7 10,-11;M10,-2 Q8,-9 11,-15;M10,-2 Q12,-7 10,-11" dur="2.5s" repeatCount="indefinite" begin="0.4s" />
        </path>
        <path d="M14,-2 Q13,-6 15,-10" fill="none" stroke="#FBBF24" strokeWidth="0.5" opacity="0.2">
          <animate attributeName="opacity" values="0;0.3;0" dur="2.5s" repeatCount="indefinite" begin="0.8s" />
          <animate attributeName="d" values="M14,-2 Q13,-6 15,-10;M14,-2 Q15,-8 13,-14;M14,-2 Q13,-6 15,-10" dur="2.5s" repeatCount="indefinite" begin="0.8s" />
        </path>
      </g>

      {/* Empty chair hint - dashed arc */}
      <g transform="translate(28, 70)">
        <path d="M0,14 Q10,4 20,14" fill="none" stroke="#FBBF24" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.25" />
        <line x1="3" y1="14" x2="3" y2="20" stroke="#FBBF24" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.2" />
        <line x1="17" y1="14" x2="17" y2="20" stroke="#FBBF24" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.2" />
      </g>

      {/* Keyboard - dim */}
      <g transform="translate(62, 78)" opacity="0.3">
        <rect x="0" y="0" width="36" height="8" rx="1" fill="#1E293B" stroke="#334155" strokeWidth="0.5" />
      </g>

      {/* Small plant accent */}
      <g transform="translate(16, 72)" opacity="0.4">
        <rect x="2" y="8" width="6" height="8" rx="1" fill="#064E3B" />
        <path d="M5,8 Q3,2 5,0 Q7,2 5,8" fill="#34D399" opacity="0.6" />
        <path d="M5,6 Q1,3 3,0" fill="none" stroke="#34D399" strokeWidth="0.6" opacity="0.5" />
        <path d="M5,6 Q9,3 7,0" fill="none" stroke="#34D399" strokeWidth="0.6" opacity="0.5" />
      </g>
    </svg>
  </div>
);

/** Disabled: powered-off abandoned terminal */
const WorkstationDisabled: React.FC = () => (
  <div className="relative w-full h-24 flex items-end justify-center opacity-[0.45]">
    <svg viewBox="0 0 160 96" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Desk surface line - dashed, no glow */}
      <line x1="10" y1="88" x2="150" y2="88" stroke="#475569" strokeWidth="1" strokeDasharray="6 4" opacity="0.3" />

      {/* Main screen - black with noise */}
      <g transform="translate(50, 26)">
        <rect x="0" y="0" width="60" height="40" rx="2" fill="#0F172A" stroke="#475569" strokeWidth="0.6" opacity="0.5" />
        {/* Noise texture overlay */}
        <rect x="0" y="0" width="60" height="40" rx="2" filter="url(#cyber-noise)" opacity="0.15">
          <animate attributeName="opacity" values="0.1;0.25;0.1" dur="5s" repeatCount="indefinite" />
        </rect>
        {/* OFFLINE text with glitch */}
        <text x="30" y="22" textAnchor="middle" fill="#EF4444" fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.7">
          <animate attributeName="x" values="30;28;32;30;29;31;30" dur="6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0.5;0.8;0.3;0.7" dur="6s" repeatCount="indefinite" />
          OFFLINE
        </text>
        {/* Ghost text shadow - glitch effect */}
        <text x="31" y="21.5" textAnchor="middle" fill="#475569" fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.3">
          <animate attributeName="x" values="31;33;29;31;32;30;31" dur="6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.15;0.3;0.1;0.25;0.15" dur="6s" repeatCount="indefinite" />
          OFFLINE
        </text>
        {/* Screen stand */}
        <rect x="24" y="40" width="12" height="4" fill="#1E293B" opacity="0.5" />
        <rect x="18" y="44" width="24" height="2" rx="1" fill="#1E293B" opacity="0.5" />
      </g>

      {/* PCB circuit line decorations */}
      <g stroke="#475569" strokeWidth="0.6" fill="none" opacity="0.2">
        {/* Circuit trace 1 */}
        <path d="M50,50 L40,50 L40,60 L30,60" />
        <circle cx="30" cy="60" r="1.5" fill="#475569" opacity="0.3" />
        {/* Circuit trace 2 */}
        <path d="M110,50 L120,50 L120,62 L132,62" />
        <circle cx="132" cy="62" r="1.5" fill="#475569" opacity="0.3" />
        {/* Circuit trace 3 */}
        <path d="M80,66 L80,72 L70,72 L70,78" />
        <circle cx="70" cy="78" r="1" fill="#475569" opacity="0.3" />
      </g>

      {/* Power LED - dark red, ultra-slow blink */}
      <circle cx="80" cy="20" r="2" fill="#EF4444" opacity="0.2">
        <animate attributeName="opacity" values="0.1;0.5;0.1" dur="10s" repeatCount="indefinite" />
      </circle>

      {/* Keyboard - very dim */}
      <g transform="translate(62, 78)" opacity="0.2">
        <rect x="0" y="0" width="36" height="8" rx="1" fill="#1E293B" stroke="#334155" strokeWidth="0.3" />
      </g>
    </svg>
  </div>
);

const WorkstationScene: Record<DeskStatus, React.FC> = {
  executing: WorkstationExecuting,
  standby: WorkstationStandby,
  enabled: WorkstationEnabled,
  disabled: WorkstationDisabled,
};

/* ---------- Status config ---------- */

const statusConfig: Record<DeskStatus, {
  border: string;
  bg: string;
  label: string;
  labelKey: string;
  tagBg: string;
  tagText: string;
  nameplateAccent: string;
}> = {
  executing: {
    border: 'border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/20',
    bg: 'bg-slate-800/95',
    label: '工作中',
    labelKey: 'aiDashboard.deskCard.executing',
    tagBg: 'bg-cyan-500/15',
    tagText: 'text-cyan-400',
    nameplateAccent: 'from-cyan-500/30 to-cyan-600/10',
  },
  standby: {
    border: 'border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)] ring-1 ring-emerald-500/15',
    bg: 'bg-slate-800/80',
    label: '待命中',
    labelKey: 'aiDashboard.deskCard.standby',
    tagBg: 'bg-emerald-500/15',
    tagText: 'text-emerald-400',
    nameplateAccent: 'from-emerald-500/20 to-emerald-600/5',
  },
  enabled: {
    border: 'border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.08)]',
    bg: 'bg-slate-800/60',
    label: '已启用',
    labelKey: 'aiDashboard.deskCard.enabled',
    tagBg: 'bg-amber-500/15',
    tagText: 'text-amber-400',
    nameplateAccent: 'from-amber-500/15 to-amber-600/5',
  },
  disabled: {
    border: 'border-slate-700/20',
    bg: 'bg-slate-800/30',
    label: '未启用',
    labelKey: 'aiDashboard.deskCard.disabled',
    tagBg: 'bg-slate-500/15',
    tagText: 'text-slate-500',
    nameplateAccent: 'from-slate-600/10 to-slate-700/5',
  },
};

/* ---------- Component ---------- */

const DeskCard: React.FC<DeskCardProps> = ({
  definition,
  instances: _instances,
  onlineClientIds: _onlineClientIds,
  stats,
  executingCount,
  currentExecution,
  onToggle,
  onClick,
  compact = false,
  isPolling = false,
}) => {
  const { t } = useTranslation('common');

  const status = useMemo(
    () => getDeskStatus(definition, executingCount, isPolling),
    [definition, executingCount, isPolling],
  );
  const config = statusConfig[status];

  const successRate = stats?.successRate ?? 0;
  const totalExec = stats?.totalExecutions ?? 0;
  const avgMs = stats?.avgDurationMs ?? 0;

  const barColor = successRate > 80
    ? 'bg-emerald-500'
    : successRate > 60
      ? 'bg-amber-500'
      : 'bg-red-500';

  const capability = definition.requiredCapability || definition.capability || '-';

  const Scene = WorkstationScene[status];

  // compact mode (for floating panel)
  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`rounded-lg border p-3 cursor-pointer transition-all ${config.border} ${config.bg} hover:border-slate-600/60`}
      >
        {/* Row 1: desk icon + code + status tag */}
        <div className="flex items-center gap-2 mb-1">
          {status === 'executing' ? (
            <Monitor className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 desk-compact-pulse" />
          ) : status === 'standby' ? (
            <Monitor className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          ) : status === 'enabled' ? (
            <Coffee className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
          ) : (
            <MonitorOff className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
          <span className="text-xs font-medium text-white truncate flex-1">{definition.code}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${config.tagBg} ${config.tagText}`}>
            {t(config.labelKey, config.label)}
          </span>
        </div>
        {/* Row 2: name */}
        <div className="text-xs text-slate-400 truncate mb-1">{definition.name}</div>
        {/* Row 3: working status */}
        {status === 'executing' && currentExecution ? (
          <div className="flex items-center gap-1 text-xs text-cyan-400">
            <Zap className="w-3 h-3 animate-pulse" />
            <span className="truncate">
              {t('aiDashboard.deskCard.processing', '正在处理任务')} ({formatElapsed(currentExecution.createdAt)})
            </span>
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            {t(config.labelKey, config.label)}
          </div>
        )}
      </div>
    );
  }

  // normal mode - full workstation card
  return (
    <div
      onClick={onClick}
      className={`group rounded-xl border cursor-pointer transition-all relative overflow-hidden ${config.border} ${config.bg} hover:border-slate-500/50 hover:translate-y-[-1px]`}
    >
      {/* SVG defs for noise filter */}
      <CyberSvgDefs />

      {/* executing background pulse */}
      {status === 'executing' && (
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-cyan-400/8 to-transparent animate-pulse pointer-events-none" />
      )}

      {/* ===== Workstation Illustration ===== */}
      <div className="relative px-4 pt-3 pb-1">
        <Scene />
      </div>

      {/* ===== Nameplate: code + toggle ===== */}
      <div className={`mx-3 mb-2 px-3 py-1.5 rounded-lg bg-gradient-to-r ${config.nameplateAccent} backdrop-blur-sm relative`}>
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate leading-tight">{definition.code}</div>
            <div className="text-[11px] text-slate-400 truncate">{definition.name}</div>
          </div>
          {/* Toggle switch */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (definition.enabled) onToggle(definition.id);
            }}
            title={isPolling ? t('aiDashboard.deskCard.stopPolling', '停止轮询') : t('aiDashboard.deskCard.startPolling', '启动轮询')}
            className={`w-9 h-[18px] rounded-full transition-colors flex-shrink-0 relative ml-2 ${
              !definition.enabled ? 'bg-slate-700 cursor-not-allowed' :
              isPolling ? 'bg-indigo-500 cursor-pointer hover:bg-indigo-400' : 'bg-slate-600 cursor-pointer hover:bg-slate-500'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm absolute top-[1.5px] transition-all ${
                isPolling ? 'left-[19px]' : 'left-[2px]'
              }`}
            />
          </div>
        </div>
      </div>

      {/* ===== Status + Capability ===== */}
      <div className="px-3 pb-2 relative">
        {/* Status tag */}
        <div className={`flex items-center gap-1.5 mb-1.5 px-2 py-1 rounded-md text-xs font-medium ${config.tagBg} ${config.tagText}`}>
          {status === 'executing' ? (
            <>
              <Zap className="w-3 h-3 animate-pulse" />
              {currentExecution ? (
                <span className="truncate">
                  {t('aiDashboard.deskCard.processing', '正在处理任务')} ({formatElapsed(currentExecution.createdAt)})
                </span>
              ) : (
                <span>{t('aiDashboard.agentCard.executing', { count: executingCount })}</span>
              )}
            </>
          ) : (
            <span>{t(config.labelKey, config.label)}</span>
          )}
        </div>

        {/* Capability badge */}
        <div className="text-[11px] text-slate-500 mb-2 truncate">
          {t('aiDashboard.agentCard.capability', '能力')}: <span className="text-slate-400">{capability}</span>
        </div>

        {/* Execution stats + success bar */}
        {totalExec > 0 && (
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1 flex-wrap">
              <span>
                {t('aiDashboard.executionLog.execCount', '执行 {{count}} 次', { count: totalExec })}
              </span>
              <span className="text-slate-600">|</span>
              <span>
                {t('aiDashboard.deskCard.successRate', '成功率 {{rate}}%', { rate: Math.round(successRate) })}
              </span>
              <span className="text-slate-600">|</span>
              <span>
                {t('aiDashboard.deskCard.avgDuration', '均 {{duration}}', { duration: avgMs < 1000 ? `${Math.round(avgMs)}ms` : `${(avgMs / 1000).toFixed(1)}s` })}
              </span>
            </div>
            <div className="h-1 rounded-full bg-slate-700/80">
              <div
                className={`h-1 rounded-full ${barColor} transition-all`}
                style={{ width: `${Math.min(100, successRate)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeskCard;
