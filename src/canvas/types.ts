/**
 * Detection box from the visual analysis pipeline
 */
export interface DetectionBox {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  confidence: number;
  icon_file?: string;
  type?: 'icon' | 'text' | 'button' | 'input' | 'unknown';
}

/**
 * Region grouping multiple boxes
 */
export interface Region {
  id: number;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  box_ids: number[];
  label?: string;
}

/**
 * Canvas data structure
 */
export interface CanvasData {
  boxes: DetectionBox[];
  regions?: Region[];
  stats?: {
    total_boxes: number;
    ocr_processed: number;
    detection_time_ms?: number;
  };
  background_image?: string;
  backgroundImage?: string;
  timestamp?: number;
}

/**
 * Layer visibility configuration
 */
export interface LayerVisibility {
  background: boolean;  // Background image
  components: boolean;  // Box borders
  icons: boolean;       // Icon thumbnails  
  texts: boolean;       // OCR labels
  regions: boolean;     // Region groupings
}

/**
 * Canvas configuration options
 */
export interface MoireCanvasConfig {
  /** Initial zoom level (default: 1) */
  zoom?: number;
  /** Show minimap (default: true) */
  showMinimap?: boolean;
  /** Initial layer visibility */
  layers?: Partial<LayerVisibility>;
  /** Auto-refresh interval in ms (0 = disabled) */
  autoRefreshInterval?: number;
  /** Background image URL */
  backgroundImage?: string;
  /** Base URL for icon images */
  iconBaseUrl?: string;
}

/**
 * Events emitted by the canvas
 */
export interface MoireCanvasEvents {
  'box-click': CustomEvent<{ box: DetectionBox }>;
  'box-hover': CustomEvent<{ box: DetectionBox | null }>;
  'moire-toggle': CustomEvent<{ enabled: boolean }>;
  'refresh-request': CustomEvent<void>;
  'layer-change': CustomEvent<{ layer: keyof LayerVisibility; visible: boolean }>;
  'zoom-change': CustomEvent<{ zoom: number }>;
  'search': CustomEvent<{ query: string; results: DetectionBox[] }>;
}

/**
 * Command sent to host application
 */
export interface CanvasCommand {
  action: string;
  value?: string | number | boolean;
}

/**
 * Message handler for IPC communication
 */
export type MessageHandler = (command: CanvasCommand) => void;

/**
 * API exposed to host application
 */
export interface MoireCanvasAPI {
  loadBoxData(data: CanvasData): void;
  fitToContent(): void;
  panTo(x: number, y: number): void;
  zoomTo(level: number): void;
  highlightBox(boxId: number): void;
  highlightBoxes(boxIds: number[]): void;
  clearHighlights(): void;
  searchText(query: string): DetectionBox[];
  setLayerVisibility(layer: keyof LayerVisibility, visible: boolean): void;
  setAutoRefresh(enabled: boolean): void;
  getMoireEnabled(): boolean;
  setMoireEnabled(enabled: boolean): void;
}