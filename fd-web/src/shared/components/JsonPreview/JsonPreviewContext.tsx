import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import type {
  JsonPreviewPanelState,
  OpenPreviewOptions,
  JsonPreviewContextValue,
} from './types';
import {
  DEFAULT_PANEL_SIZE,
  CASCADE_OFFSET,
  BASE_Z_INDEX,
} from './types';
import JsonPreviewContainer from './JsonPreviewContainer';

// ── Internal context (includes panels + dispatch helpers) ────────────

interface InternalContextValue extends JsonPreviewContextValue {
  // Exposed for JsonPreviewContainer
}

const JsonPreviewInternalContext = createContext<InternalContextValue | null>(null);

/** Internal hook used by JsonPreviewContainer and JsonPreviewPanel. */
export function useJsonPreviewInternal(): InternalContextValue {
  const ctx = useContext(JsonPreviewInternalContext);
  if (!ctx) {
    throw new Error('useJsonPreviewInternal must be used within JsonPreviewProvider');
  }
  return ctx;
}

// ── Public context (same shape, just a re-export gate) ───────────────

const JsonPreviewPublicContext = createContext<JsonPreviewContextValue | null>(null);

// ── Reducer ──────────────────────────────────────────────────────────

interface State {
  panels: JsonPreviewPanelState[];
  topZIndex: number;
}

type Action =
  | { type: 'OPEN'; panel: JsonPreviewPanelState }
  | { type: 'CLOSE'; id: string }
  | { type: 'CLOSE_ALL' }
  | { type: 'BRING_TO_FRONT'; id: string }
  | { type: 'TOGGLE_MINIMIZE'; id: string }
  | { type: 'TOGGLE_MAXIMIZE'; id: string }
  | { type: 'UPDATE_POSITION'; id: string; position: { x: number; y: number } }
  | { type: 'UPDATE_SIZE'; id: string; size: { width: number; height: number } };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'OPEN': {
      const newTopZ = state.topZIndex + 1;
      return {
        panels: [...state.panels, { ...action.panel, zIndex: newTopZ }],
        topZIndex: newTopZ,
      };
    }

    case 'CLOSE':
      return {
        ...state,
        panels: state.panels.filter(p => p.id !== action.id),
      };

    case 'CLOSE_ALL':
      return { ...state, panels: [] };

    case 'BRING_TO_FRONT': {
      const newTopZ = state.topZIndex + 1;
      return {
        topZIndex: newTopZ,
        panels: state.panels.map(p =>
          p.id === action.id ? { ...p, zIndex: newTopZ } : p
        ),
      };
    }

    case 'TOGGLE_MINIMIZE':
      return {
        ...state,
        panels: state.panels.map(p => {
          if (p.id !== action.id) return p;
          if (p.minimized) {
            // Restore from minimize
            return { ...p, minimized: false };
          }
          // Minimize (also un-maximize if maximized)
          return { ...p, minimized: true, maximized: false };
        }),
      };

    case 'TOGGLE_MAXIMIZE':
      return {
        ...state,
        panels: state.panels.map(p => {
          if (p.id !== action.id) return p;
          if (p.maximized) {
            // Restore from maximize
            const prev = p.preMaximizeState;
            return {
              ...p,
              maximized: false,
              position: prev?.position ?? p.position,
              size: prev?.size ?? p.size,
              preMaximizeState: undefined,
            };
          }
          // Maximize
          return {
            ...p,
            maximized: true,
            minimized: false,
            preMaximizeState: { position: p.position, size: p.size },
            position: { x: 0, y: 0 },
            size: { width: window.innerWidth, height: window.innerHeight },
          };
        }),
      };

    case 'UPDATE_POSITION':
      return {
        ...state,
        panels: state.panels.map(p =>
          p.id === action.id ? { ...p, position: action.position } : p
        ),
      };

    case 'UPDATE_SIZE':
      return {
        ...state,
        panels: state.panels.map(p =>
          p.id === action.id ? { ...p, size: action.size } : p
        ),
      };

    default:
      return state;
  }
}

// ── ID generator ─────────────────────────────────────────────────────

function generatePanelId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Provider ─────────────────────────────────────────────────────────

export const JsonPreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, { panels: [], topZIndex: BASE_Z_INDEX });

  const openPreview = useCallback((options: OpenPreviewOptions): string => {
    const id = generatePanelId();
    const panelCount = state.panels.length;
    const panel: JsonPreviewPanelState = {
      id,
      title: options.title,
      json: options.json,
      position: options.position ?? {
        x: 100 + panelCount * CASCADE_OFFSET,
        y: 80 + panelCount * CASCADE_OFFSET,
      },
      size: options.size ?? { ...DEFAULT_PANEL_SIZE },
      zIndex: BASE_Z_INDEX,
      minimized: false,
      maximized: false,
      compareJson: options.compareJson,
      compareTitle: options.compareTitle,
    };
    dispatch({ type: 'OPEN', panel });
    return id;
    // NOTE: We read state.panels.length for cascade offset. Because useCallback
    // captures the closure at creation time, we intentionally include state.panels.length
    // in deps so new panels cascade correctly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.panels.length]);

  const closePreview = useCallback((id: string) => {
    dispatch({ type: 'CLOSE', id });
  }, []);

  const closeAll = useCallback(() => {
    dispatch({ type: 'CLOSE_ALL' });
  }, []);

  const bringToFront = useCallback((id: string) => {
    dispatch({ type: 'BRING_TO_FRONT', id });
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_MINIMIZE', id });
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_MAXIMIZE', id });
  }, []);

  const updatePosition = useCallback((id: string, position: { x: number; y: number }) => {
    dispatch({ type: 'UPDATE_POSITION', id, position });
  }, []);

  const updateSize = useCallback((id: string, size: { width: number; height: number }) => {
    dispatch({ type: 'UPDATE_SIZE', id, size });
  }, []);

  const contextValue = useMemo<InternalContextValue>(() => ({
    panels: state.panels,
    openPreview,
    closePreview,
    closeAll,
    bringToFront,
    toggleMinimize,
    toggleMaximize,
    updatePosition,
    updateSize,
  }), [
    state.panels,
    openPreview,
    closePreview,
    closeAll,
    bringToFront,
    toggleMinimize,
    toggleMaximize,
    updatePosition,
    updateSize,
  ]);

  return (
    <JsonPreviewInternalContext.Provider value={contextValue}>
      <JsonPreviewPublicContext.Provider value={contextValue}>
        {children}
        <JsonPreviewContainer />
      </JsonPreviewPublicContext.Provider>
    </JsonPreviewInternalContext.Provider>
  );
};

// ── Public hook ──────────────────────────────────────────────────────

/** Noop fallback returned when useJsonPreview is called outside Provider (e.g. HMR / ErrorBoundary recovery). */
const NOOP_CONTEXT: JsonPreviewContextValue = {
  panels: [],
  openPreview: () => '',
  closePreview: () => {},
  closeAll: () => {},
  bringToFront: () => {},
  toggleMinimize: () => {},
  toggleMaximize: () => {},
  updatePosition: () => {},
  updateSize: () => {},
};

export function useJsonPreview(): JsonPreviewContextValue {
  const ctx = useContext(JsonPreviewPublicContext);
  // Gracefully fallback instead of throwing — avoids ErrorBoundary loops
  // when Provider is temporarily unavailable (HMR, lazy loading race, etc.)
  return ctx ?? NOOP_CONTEXT;
}
