export interface JsonPreviewPanelState {
  id: string;
  title: string;
  json: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  preMaximizeState?: { position: { x: number; y: number }; size: { width: number; height: number } };
  compareJson?: string;
  compareTitle?: string;
}

export interface OpenPreviewOptions {
  title: string;
  json: string;
  compareJson?: string;
  compareTitle?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface JsonPreviewContextValue {
  panels: JsonPreviewPanelState[];
  openPreview: (options: OpenPreviewOptions) => string;
  closePreview: (id: string) => void;
  closeAll: () => void;
  bringToFront: (id: string) => void;
  toggleMinimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  updatePosition: (id: string, pos: { x: number; y: number }) => void;
  updateSize: (id: string, size: { width: number; height: number }) => void;
}

export const DEFAULT_PANEL_SIZE = { width: 720, height: 520 };
export const MIN_PANEL_SIZE = { width: 400, height: 300 };
export const CASCADE_OFFSET = 30;
export const BASE_Z_INDEX = 200;
