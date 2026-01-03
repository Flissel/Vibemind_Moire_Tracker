/**
 * Moire Canvas - Electron Embeddable
 * TypeScript Definitions for postMessage API
 */

// ======================================
// Detection Types
// ======================================

export interface MoireBox {
  id?: number | string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  text?: string;
  type?: 'text' | 'icon' | 'button' | 'image' | 'unknown';
  metadata?: Record<string, unknown>;
}

export interface MoireDetectionResult {
  boxes: MoireBox[];
  count: number;
  timestamp?: number;
  frameId?: string;
  changePercent?: number;
}

// ======================================
// Messages FROM Parent TO Canvas
// ======================================

export interface MoireInitMessage {
  type: 'moire:init';
  wsUrl?: string;  // Custom WebSocket URL (default: ws://localhost:8765)
}

export interface MoireSetBoxesMessage {
  type: 'moire:setBoxes';
  boxes: MoireBox[];
}

export interface MoireSetBackgroundMessage {
  type: 'moire:setBackground';
  imageData: string;  // Base64 data URL
}

export interface MoireToggleMoireMessage {
  type: 'moire:toggleMoire';
  enabled: boolean;
}

export interface MoireToggleAutoMessage {
  type: 'moire:toggleAuto';
  enabled: boolean;
}

export interface MoireCaptureOnceMessage {
  type: 'moire:captureOnce';
}

export interface MoireZoomMessage {
  type: 'moire:zoom';
  level: number;  // 0.1 to 5
}

export interface MoirePanMessage {
  type: 'moire:pan';
  x: number;
  y: number;
}

export interface MoireGetStateMessage {
  type: 'moire:getState';
}

export type MoireParentMessage =
  | MoireInitMessage
  | MoireSetBoxesMessage
  | MoireSetBackgroundMessage
  | MoireToggleMoireMessage
  | MoireToggleAutoMessage
  | MoireCaptureOnceMessage
  | MoireZoomMessage
  | MoirePanMessage
  | MoireGetStateMessage;

// ======================================
// Messages FROM Canvas TO Parent
// ======================================

export interface MoireLoadedEvent {
  type: 'moire:loaded';
  version: string;
}

export interface MoireReadyEvent {
  type: 'moire:ready';
  version: string;
}

export interface MoireConnectedEvent {
  type: 'moire:connected';
}

export interface MoireDisconnectedEvent {
  type: 'moire:disconnected';
}

export interface MoireStreamStartedEvent {
  type: 'moire:streamStarted';
}

export interface MoireStreamStoppedEvent {
  type: 'moire:streamStopped';
}

export interface MoireDetectionEvent {
  type: 'moire:detection';
  boxes: MoireBox[];
  count: number;
}

export interface MoireBoxHoverEvent {
  type: 'moire:boxHover';
  box: MoireBox;
}

export interface MoireBoxClickEvent {
  type: 'moire:boxClick';
  box: MoireBox;
}

export interface MoireBoxesUpdatedEvent {
  type: 'moire:boxesUpdated';
  count: number;
}

export interface MoireBackgroundLoadedEvent {
  type: 'moire:backgroundLoaded';
  size: { w: number; h: number };
}

export interface MoireMoireToggledEvent {
  type: 'moire:moireToggled';
  enabled: boolean;
}

export interface MoireMoireToggleEvent {
  type: 'moire:moireToggle';
  enabled: boolean;
}

export interface MoireAutoToggleEvent {
  type: 'moire:autoToggle';
  enabled: boolean;
}

export interface MoireStateEvent {
  type: 'moire:state';
  connected: boolean;
  streaming: boolean;
  boxes: number;
  zoom: number;
  pan: { x: number; y: number };
  size: { w: number; h: number };
}

export type MoireCanvasEvent =
  | MoireLoadedEvent
  | MoireReadyEvent
  | MoireConnectedEvent
  | MoireDisconnectedEvent
  | MoireStreamStartedEvent
  | MoireStreamStoppedEvent
  | MoireDetectionEvent
  | MoireBoxHoverEvent
  | MoireBoxClickEvent
  | MoireBoxesUpdatedEvent
  | MoireBackgroundLoadedEvent
  | MoireMoireToggledEvent
  | MoireMoireToggleEvent
  | MoireAutoToggleEvent
  | MoireStateEvent;

// ======================================
// Electron Integration Helper Class
// ======================================

export interface MoireCanvasOptions {
  containerId?: string;
  wsUrl?: string;
  autoConnect?: boolean;
  onDetection?: (boxes: MoireBox[], count: number) => void;
  onBoxClick?: (box: MoireBox) => void;
  onBoxHover?: (box: MoireBox | null) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/**
 * Helper class for embedding Moire Canvas in Electron
 * 
 * Usage in Electron renderer:
 * ```typescript
 * import { MoireCanvas } from 'moire-canvas';
 * 
 * const canvas = new MoireCanvas({
 *   containerId: 'moire-container',
 *   wsUrl: 'ws://localhost:8765',
 *   onDetection: (boxes, count) => console.log(`Detected ${count} boxes`),
 *   onBoxClick: (box) => console.log('Clicked:', box)
 * });
 * 
 * await canvas.init();
 * ```
 */
export class MoireCanvas {
  private iframe: HTMLIFrameElement | null = null;
  private options: MoireCanvasOptions;
  private ready = false;
  private readyPromise: Promise<void>;
  private readyResolve: () => void = () => {};

  constructor(options: MoireCanvasOptions = {}) {
    this.options = {
      containerId: 'moire-container',
      wsUrl: 'ws://localhost:8765',
      autoConnect: true,
      ...options
    };

    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Listen for messages from iframe
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  /**
   * Initialize the canvas iframe
   */
  async init(): Promise<void> {
    const container = document.getElementById(this.options.containerId!);
    if (!container) {
      throw new Error(`Container element #${this.options.containerId} not found`);
    }

    // Create iframe
    this.iframe = document.createElement('iframe');
    this.iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
    this.iframe.src = this.getCanvasUrl();
    container.appendChild(this.iframe);

    // Wait for canvas to load
    await this.readyPromise;

    // Send init message
    if (this.options.autoConnect) {
      this.sendMessage({ type: 'moire:init', wsUrl: this.options.wsUrl });
    }
  }

  /**
   * Get the URL for the canvas HTML
   */
  private getCanvasUrl(): string {
    // In Electron, this would be the path to the bundled HTML
    // For development, use the local file
    if (typeof __dirname !== 'undefined') {
      return `file://${__dirname}/canvas-embed.html`;
    }
    // Fallback for browser testing
    return './canvas-embed.html';
  }

  /**
   * Handle messages from the canvas iframe
   */
  private handleMessage(event: MessageEvent<MoireCanvasEvent>): void {
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || !msg.type?.startsWith('moire:')) return;

    switch (msg.type) {
      case 'moire:loaded':
      case 'moire:ready':
        this.ready = true;
        this.readyResolve();
        break;

      case 'moire:connected':
        this.options.onConnected?.();
        break;

      case 'moire:disconnected':
        this.options.onDisconnected?.();
        break;

      case 'moire:detection':
        this.options.onDetection?.(msg.boxes, msg.count);
        break;

      case 'moire:boxClick':
        this.options.onBoxClick?.(msg.box);
        break;

      case 'moire:boxHover':
        this.options.onBoxHover?.(msg.box);
        break;
    }
  }

  /**
   * Send a message to the canvas
   */
  private sendMessage(msg: MoireParentMessage): void {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage(msg, '*');
    }
  }

  /**
   * Connect to the WebSocket server
   */
  connect(wsUrl?: string): void {
    this.sendMessage({ type: 'moire:init', wsUrl: wsUrl || this.options.wsUrl });
  }

  /**
   * Manually set detection boxes
   */
  setBoxes(boxes: MoireBox[]): void {
    this.sendMessage({ type: 'moire:setBoxes', boxes });
  }

  /**
   * Set background image
   */
  setBackground(imageDataUrl: string): void {
    this.sendMessage({ type: 'moire:setBackground', imageData: imageDataUrl });
  }

  /**
   * Toggle Moiré filter
   */
  toggleMoire(enabled: boolean): void {
    this.sendMessage({ type: 'moire:toggleMoire', enabled });
  }

  /**
   * Toggle auto-detection
   */
  toggleAuto(enabled: boolean): void {
    this.sendMessage({ type: 'moire:toggleAuto', enabled });
  }

  /**
   * Capture once (single detection)
   */
  captureOnce(): void {
    this.sendMessage({ type: 'moire:captureOnce' });
  }

  /**
   * Set zoom level
   */
  setZoom(level: number): void {
    this.sendMessage({ type: 'moire:zoom', level });
  }

  /**
   * Set pan position
   */
  setPan(x: number, y: number): void {
    this.sendMessage({ type: 'moire:pan', x, y });
  }

  /**
   * Get current state
   */
  async getState(): Promise<MoireStateEvent> {
    return new Promise((resolve) => {
      const handler = (event: MessageEvent<MoireCanvasEvent>) => {
        if (event.data?.type === 'moire:state') {
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      this.sendMessage({ type: 'moire:getState' });
    });
  }

  /**
   * Check if canvas is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Destroy the canvas
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage.bind(this));
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }
}

export default MoireCanvas;