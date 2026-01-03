/**
 * WebSocket Client for Moiré Canvas
 * 
 * Handles connection to backend server for:
 * - Live frame streaming
 * - Detection results
 * - Moiré analysis commands
 */

import type { CanvasData, DetectionBox, Region } from './types';

// ============================================================================ 
// WebSocket Message Types
// ============================================================================

export type WebSocketMessageType =
  | 'handshake'
  | 'frame_data'
  | 'dual_screen_frame'
  | 'moire_detection_result'
  | 'analyze_frame'
  | 'toggle_moire'
  | 'refresh_canvas'
  | 'start_stream'
  | 'stop_stream'
  | 'get_desktop_clients'
  | 'desktop_clients_list'
  | 'desktop_connected'
  | 'desktop_disconnected'
  | 'error';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  timestamp?: string;
  [key: string]: any;
}

export interface HandshakeMessage extends WebSocketMessage {
  type: 'handshake';
  clientInfo: {
    clientType: string;
    clientId: string;
    capabilities: string[];
  };
}

export interface FrameDataMessage extends WebSocketMessage {
  type: 'frame_data' | 'dual_screen_frame';
  frameData?: string;
  image_data?: string;
  metadata?: {
    format?: string;
    width?: number;
    height?: number;
  };
  format?: string;
}

export interface DetectionResultMessage extends WebSocketMessage {
  type: 'moire_detection_result';
  boxes: DetectionBox[];
  regions?: Region[];
  stats?: {
    total_boxes: number;
    ocr_processed: number;
    detection_time_ms?: number;
  };
}

export interface DesktopClientsMessage extends WebSocketMessage {
  type: 'desktop_clients_list';
  clients: Array<{
    id: string;
    clientId?: string;
    name?: string;
    connected: boolean;
  }>;
}

// ============================================================================ 
// Connection Configuration 
// ============================================================================

export interface MoireWebSocketConfig {
  /** WebSocket server URL */
  url: string;
  /** Client identifier (auto-generated if not provided) */
  clientId?: string;
  /** Component name for logging */
  componentName?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 5000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Ping interval in ms (default: 60000) */
  pingInterval?: number;
}

export interface MoireWebSocketEvents {
  onConnect?: () => void;
  onDisconnect?: (code: number, reason: string) => void;
  onError?: (error: Event) => void;
  onFrame?: (imageUrl: string, metadata?: FrameDataMessage['metadata']) => void;
  onDetectionResult?: (data: CanvasData) => void;
  onDesktopClients?: (clients: DesktopClientsMessage['clients']) => void;
  onMessage?: (message: WebSocketMessage) => void;
}

// ============================================================================ 
// WebSocket Client Class 
// ============================================================================

export class MoireWebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<MoireWebSocketConfig>;
  private events: MoireWebSocketEvents = {};
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private isManualClose = false;
  private selectedDesktopClient: string | null = null;

  constructor(config: MoireWebSocketConfig) {
    this.config = {
      url: config.url,
      clientId: config.clientId || `moire_canvas_${Date.now()}`,
      componentName: config.componentName || 'moire_canvas',
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      pingInterval: config.pingInterval ?? 60000,
    };
  }

  // ==================== Event Registration ====================

  on<K extends keyof MoireWebSocketEvents>(
    event: K,
    handler: MoireWebSocketEvents[K]
  ): this {
    this.events[event] = handler;
    return this;
  }

  off<K extends keyof MoireWebSocketEvents>(event: K): this {
    delete this.events[event];
    return this;
  }

  // ==================== Connection Management ====================

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isManualClose = false;
      
      // Build URL with query parameters
      const params = new URLSearchParams({
        client_type: 'web',
        client_id: this.config.clientId,
      });
      const fullUrl = `${this.config.url}?${params.toString()}`;
      
      console.log('[MoireWS] Connecting to:', fullUrl);
      
      try {
        this.ws = new WebSocket(fullUrl);
        
        this.ws.onopen = () => {
          console.log('[MoireWS] Connected');
          this.reconnectAttempts = 0;
          this.sendHandshake();
          this.startPing();
          this.events.onConnect?.();
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };
        
        this.ws.onclose = (event) => {
          console.log('[MoireWS] Disconnected:', event.code, event.reason);
          this.stopPing();
          this.events.onDisconnect?.(event.code, event.reason);
          
          if (!this.isManualClose && this.config.autoReconnect) {
            this.scheduleReconnect();
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('[MoireWS] Error:', error);
          this.events.onError?.(error);
          reject(error);
        };
      } catch (error) {
        console.error('[MoireWS] Connection failed:', error);
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.isManualClose = true;
    this.stopPing();
    this.clearReconnectTimer();
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ==================== Message Sending ====================

  send(message: WebSocketMessage): boolean {
    if (!this.isConnected()) {
      console.warn('[MoireWS] Cannot send - not connected');
      return false;
    }
    
    try {
      const msgWithTimestamp = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      };
      this.ws!.send(JSON.stringify(msgWithTimestamp));
      return true;
    } catch (error) {
      console.error('[MoireWS] Send error:', error);
      return false;
    }
  }

  private sendHandshake(): void {
    const handshake: HandshakeMessage = {
      type: 'handshake',
      clientInfo: {
        clientType: 'web',
        clientId: this.config.clientId,
        capabilities: ['multi_stream_viewing'],
      },
      timestamp: new Date().toISOString(),
    };
    this.send(handshake);
    
    // Request desktop clients list after handshake
    setTimeout(() => {
      this.requestDesktopClients();
    }, 500);
  }

  // ==================== Commands ====================

  /**
   * Request list of available desktop clients
   */
  requestDesktopClients(): void {
    this.send({
      type: 'get_desktop_clients',
    });
  }

  /**
   * Select a desktop client and start streaming
   */
  selectDesktopClient(clientId: string, monitorId = 'monitor_0'): void {
    this.selectedDesktopClient = clientId;
    this.send({
      type: 'start_stream',
      desktopClientId: clientId,
      monitorId,
    });
  }

  /**
   * Stop streaming from current desktop client
   */
  stopStream(): void {
    if (this.selectedDesktopClient) {
      this.send({
        type: 'stop_stream',
        desktopClientId: this.selectedDesktopClient,
      });
      this.selectedDesktopClient = null;
    }
  }

  /**
   * Request frame analysis (Moiré detection)
   */
  analyzeFrame(frameData?: string): void {
    this.send({
      type: 'analyze_frame',
      desktopClientId: this.selectedDesktopClient,
      frameData,
      moireEnabled: true,
    });
  }

  /**
   * Toggle Moiré detection
   */
  toggleMoire(enabled?: boolean): void {
    this.send({
      type: 'toggle_moire',
      enabled,
    });
  }

  /**
   * Request canvas refresh (new frame + analysis)
   */
  refreshCanvas(): void {
    this.send({
      type: 'refresh_canvas',
      desktopClientId: this.selectedDesktopClient,
    });
  }

  // ==================== Message Handling ====================

  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      // Always emit generic message event
      this.events.onMessage?.(message);
      
      switch (message.type) {
        case 'frame_data':
        case 'dual_screen_frame':
          this.handleFrameData(message as FrameDataMessage);
          break;
          
        case 'moire_detection_result':
          this.handleDetectionResult(message as DetectionResultMessage);
          break;
          
        case 'desktop_clients_list':
          this.handleDesktopClients(message as DesktopClientsMessage);
          break;
          
        case 'desktop_connected':
          console.log('[MoireWS] Desktop connected:', message.desktopClientId);
          this.requestDesktopClients();
          break;
          
        case 'desktop_disconnected':
          console.log('[MoireWS] Desktop disconnected:', message.desktopClientId);
          if (this.selectedDesktopClient === message.desktopClientId) {
            this.selectedDesktopClient = null;
          }
          this.requestDesktopClients();
          break;
          
        case 'error':
          console.error('[MoireWS] Server error:', message.error || message.message);
          break;
          
        default:
          // Unknown message type - ignore
          break;
      }
    } catch (error) {
      console.error('[MoireWS] Message parse error:', error);
    }
  }

  private handleFrameData(message: FrameDataMessage): void {
    const frameData = message.frameData || message.image_data;
    const format = message.metadata?.format || message.format || 'jpeg';
    
    if (frameData) {
      const imageUrl = `data:image/${format};base64,${frameData}`;
      this.events.onFrame?.(imageUrl, message.metadata);
    }
  }

  private handleDetectionResult(message: DetectionResultMessage): void {
    const canvasData: CanvasData = {
      boxes: message.boxes || [],
      regions: message.regions || [],
      stats: message.stats,
    };
    this.events.onDetectionResult?.(canvasData);
  }

  private handleDesktopClients(message: DesktopClientsMessage): void {
    const clients = (message.clients || []).map(client => ({
      ...client,
      id: client.clientId || client.id,
    }));
    this.events.onDesktopClients?.(clients);
  }

  // ==================== Reconnection Logic ====================

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[MoireWS] Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 3);
    
    console.log(`[MoireWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
    
    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch(() => {
        // Error handled in connect()
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ==================== Ping/Pong ====================

  private startPing(): void {
    this.pingTimer = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping' as any });
      }
    }, this.config.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ==================== Getters ====================

  getClientId(): string {
    return this.config.clientId;
  }

  getSelectedDesktopClient(): string | null {
    return this.selectedDesktopClient;
  }
}

// ============================================================================ 
// Helper Functions 
// ============================================================================

/**
 * Create a pre-configured WebSocket client for Moiré Canvas
 */
export function createMoireWebSocket(
  url: string,
  componentName = 'moire_canvas'
): MoireWebSocketClient {
  return new MoireWebSocketClient({
    url,
    componentName,
    autoReconnect: true,
  });
}

/**
 * Build WebSocket URL with Supabase Edge Function format
 */
export function buildWebSocketUrl(
  baseUrl: string,
  endpoint = '/live-desktop-stream'
): string {
  // Remove trailing slash from base URL
  const cleanBase = baseUrl.replace(/\/$/, '');
  // Ensure endpoint starts with /
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBase}${cleanEndpoint}`;
}