/**
 * @moire/canvas - Embeddable Canvas Component
 * 
 * Lightweight, cross-platform canvas component for embedding in Electron apps.
 * - No sidebar, minimal UI
 * - WebSocket integration for detection results
 * - Toggle Moiré filter
 * - Auto-refresh capability
 * 
 * @example
 * ```html
 * <moire-embed 
 *   ws-url="ws://localhost:8765"
 *   auto-refresh="true"
 *   refresh-interval="5000">
 * </moire-embed>
 * ```
 */

import { DetectionBox, Region, CanvasData, LayerVisibility } from './types';

export interface EmbeddableCanvasConfig {
  wsUrl?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  showToolbar?: boolean;
  showMinimap?: boolean;
  moirEnabled?: boolean;
}

export interface EmbeddableCanvasEvents {
  'ready': CustomEvent;
  'connected': CustomEvent<{ url: string }>;
  'disconnected': CustomEvent;
  'data-loaded': CustomEvent<{ boxCount: number }>;
  'box-click': CustomEvent<{ box: DetectionBox }>;
  'moire-toggle': CustomEvent<{ enabled: boolean }>;
  'error': CustomEvent<{ message: string }>;
}

export class MoireEmbeddableCanvas extends HTMLElement {
  private shadow: ShadowRoot;
  private data: CanvasData = { boxes: [], regions: [] };
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private highlightedBoxes = new Set<number>();
  
  // Configuration
  private moireEnabled = false;
  private autoRefreshEnabled = false;
  private autoRefreshTimer: number | null = null;
  private refreshInterval = 5000;
  
  // WebSocket
  private ws: WebSocket | null = null;
  private wsUrl: string = 'ws://localhost:8765';
  private wsReconnectTimer: number | null = null;
  private wsConnected = false;
  
  // DOM references
  private canvas!: HTMLDivElement;
  private container!: HTMLDivElement;
  private tooltip!: HTMLDivElement;
  private minimapViewport!: HTMLDivElement;
  private statusIndicator!: HTMLDivElement;

  private layerVisibility: LayerVisibility = {
    components: true,
    icons: true,
    texts: true,
    regions: false,
    background: true
  };

  private backgroundImage: string | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.parseAttributes();
    this.render();
    this.setupEventListeners();
    
    // Auto-connect if URL provided
    if (this.wsUrl) {
      this.connect();
    }
    
    // Start auto-refresh if enabled
    if (this.autoRefreshEnabled) {
      this.startAutoRefresh();
    }
    
    this.dispatchEvent(new CustomEvent('ready'));
  }

  disconnectedCallback() {
    this.disconnect();
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
  }

  static get observedAttributes() {
    return ['ws-url', 'auto-refresh', 'refresh-interval', 'show-toolbar', 'show-minimap', 'moire-enabled'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue === newValue) return;
    
    switch (name) {
      case 'ws-url':
        this.wsUrl = newValue;
        if (this.wsConnected) {
          this.disconnect();
          this.connect();
        }
        break;
      case 'auto-refresh':
        this.setAutoRefresh(newValue === 'true');
        break;
      case 'refresh-interval':
        this.refreshInterval = parseInt(newValue) || 5000;
        break;
      case 'moire-enabled':
        this.setMoireEnabled(newValue === 'true');
        break;
    }
  }

  private parseAttributes() {
    this.wsUrl = this.getAttribute('ws-url') || 'ws://localhost:8765';
    this.autoRefreshEnabled = this.getAttribute('auto-refresh') === 'true';
    this.refreshInterval = parseInt(this.getAttribute('refresh-interval') || '5000');
    this.moireEnabled = this.getAttribute('moire-enabled') === 'true';
  }

  // ==================== WebSocket ====================

  connect(url?: string) {
    if (url) this.wsUrl = url;
    
    if (this.ws) {
      this.ws.close();
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
      this.setStatus('connecting', 'Connecting...');

      this.ws.onopen = () => {
        this.wsConnected = true;
        this.setStatus('connected', 'Connected');
        
        // Send handshake
        this.ws?.send(JSON.stringify({
          type: 'handshake',
          clientId: `embed_${Date.now()}`,
          clientType: 'moire_embedded_canvas'
        }));

        this.dispatchEvent(new CustomEvent('connected', { 
          detail: { url: this.wsUrl } 
        }));
        
        // Request initial data
        this.requestDetectionResults();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleWebSocketMessage(msg);
        } catch (e) {
          console.error('[MoireEmbed] Invalid message:', e);
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        this.setStatus('disconnected', 'Disconnected');
        this.dispatchEvent(new CustomEvent('disconnected'));
        
        // Auto-reconnect after 3 seconds
        if (!this.wsReconnectTimer) {
          this.wsReconnectTimer = window.setTimeout(() => {
            this.wsReconnectTimer = null;
            this.connect();
          }, 3000);
        }
      };

      this.ws.onerror = (error) => {
        this.setStatus('error', 'Connection Error');
        this.dispatchEvent(new CustomEvent('error', { 
          detail: { message: 'WebSocket error' } 
        }));
      };
    } catch (e) {
      this.setStatus('error', 'Failed to connect');
    }
  }

  disconnect() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  private handleWebSocketMessage(msg: any) {
    switch (msg.type) {
      case 'handshake_ack':
        console.log('[MoireEmbed] Handshake acknowledged');
        break;
        
      case 'moire_detection_result':
      case 'detection_result':
        const boxes = msg.boxes || [];
        this.loadBoxData({ 
          boxes,
          regions: msg.regions || [],
          backgroundImage: msg.backgroundImage
        });
        break;
        
      case 'moire_toggle_ack':
        this.moireEnabled = msg.enabled;
        this.updateMoireUI();
        break;
        
      case 'error':
        this.dispatchEvent(new CustomEvent('error', { 
          detail: { message: msg.message } 
        }));
        break;
    }
  }

  private requestDetectionResults() {
    if (this.ws && this.wsConnected) {
      this.ws.send(JSON.stringify({ type: 'get_detection_results' }));
    }
  }

  // ==================== Public API ====================

  loadBoxData(newData: CanvasData & { backgroundImage?: string }) {
    this.data = newData;
    
    if (newData.backgroundImage) {
      this.backgroundImage = newData.backgroundImage;
    }
    
    this.renderBoxes();
    this.updateStats();
    this.updateMinimap();
    
    this.dispatchEvent(new CustomEvent('data-loaded', { 
      detail: { boxCount: newData.boxes.length } 
    }));
  }

  getBoxes(): DetectionBox[] {
    return this.data.boxes;
  }

  isWebSocketConnected(): boolean {
    return this.wsConnected;
  }

  // Moiré Filter Toggle
  getMoireEnabled(): boolean {
    return this.moireEnabled;
  }

  setMoireEnabled(enabled: boolean) {
    this.moireEnabled = enabled;
    this.updateMoireUI();
    
    // Send to backend
    if (this.ws && this.wsConnected) {
      this.ws.send(JSON.stringify({ 
        type: 'toggle_moire', 
        enabled 
      }));
    }
    
    this.dispatchEvent(new CustomEvent('moire-toggle', { 
      detail: { enabled } 
    }));
  }

  toggleMoire(): boolean {
    this.setMoireEnabled(!this.moireEnabled);
    return this.moireEnabled;
  }

  // Auto-Refresh
  getAutoRefreshEnabled(): boolean {
    return this.autoRefreshEnabled;
  }

  setAutoRefresh(enabled: boolean) {
    this.autoRefreshEnabled = enabled;
    
    if (enabled) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
    
    this.updateAutoRefreshUI();
  }

  private startAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
    
    this.autoRefreshTimer = window.setInterval(() => {
      this.refresh();
    }, this.refreshInterval);
  }

  private stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  refresh() {
    this.requestDetectionResults();
  }

  // Navigation
  fitToContent() {
    if (this.data.boxes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    this.data.boxes.forEach(b => {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const viewW = this.container.clientWidth;
    const viewH = this.container.clientHeight;

    this.zoom = Math.min(viewW / contentW, viewH / contentH) * 0.9;
    this.panX = (viewW - contentW * this.zoom) / 2 - minX * this.zoom;
    this.panY = (viewH - contentH * this.zoom) / 2 - minY * this.zoom;

    this.updateTransform();
    this.updateMinimap();
  }

  panTo(x: number, y: number) {
    this.panX = this.container.clientWidth / 2 - x * this.zoom;
    this.panY = this.container.clientHeight / 2 - y * this.zoom;
    this.updateTransform();
    this.updateMinimap();
  }

  setZoom(level: number) {
    this.zoom = level;
    this.updateTransform();
    this.updateMinimap();
  }

  // Search
  searchText(query: string): DetectionBox[] {
    if (!query) {
      this.highlightedBoxes.clear();
      this.renderBoxes();
      return [];
    }
    
    this.highlightedBoxes.clear();
    const lower = query.toLowerCase();
    const results: DetectionBox[] = [];

    this.data.boxes.forEach(box => {
      if (box.text && box.text.toLowerCase().includes(lower)) {
        this.highlightedBoxes.add(box.id);
        results.push(box);
      }
    });

    this.renderBoxes();

    if (results.length > 0) {
      const first = results[0];
      this.panTo(first.x + first.width / 2, first.y + first.height / 2);
    }

    return results;
  }

  // Layer Control
  setLayerVisibility(layer: keyof LayerVisibility, visible: boolean) {
    this.layerVisibility[layer] = visible;
    this.renderBoxes();
  }

  // ==================== Rendering ====================

  private render() {
    const showToolbar = this.getAttribute('show-toolbar') !== 'false';
    const showMinimap = this.getAttribute('show-minimap') !== 'false';
    
    this.shadow.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="embed-container">
        ${showToolbar ? this.getToolbarHTML() : ''}
        <div id="canvas-container">
          <div id="canvas"></div>
          ${showMinimap ? '<div id="minimap"><div id="minimap-viewport"></div></div>' : ''}
        </div>
        <div id="tooltip"></div>
      </div>
    `;

    this.canvas = this.shadow.getElementById('canvas') as HTMLDivElement;
    this.container = this.shadow.getElementById('canvas-container') as HTMLDivElement;
    this.tooltip = this.shadow.getElementById('tooltip') as HTMLDivElement;
    this.minimapViewport = this.shadow.getElementById('minimap-viewport') as HTMLDivElement;
    this.statusIndicator = this.shadow.getElementById('status-indicator') as HTMLDivElement;
  }

  private getToolbarHTML(): string {
    return `
      <div id="toolbar">
        <div class="toolbar-left">
          <div id="status-indicator" class="status disconnected">
            <span class="status-dot"></span>
            <span class="status-text">Disconnected</span>
          </div>
        </div>
        <div class="toolbar-center">
          <input type="text" id="search" placeholder="🔍 Search...">
          <button id="btn-fit" title="Fit to Content">⊡</button>
          <button id="btn-refresh" title="Refresh">↻</button>
        </div>
        <div class="toolbar-right">
          <label class="toggle-label" title="Toggle Moiré Filter">
            <input type="checkbox" id="moire-toggle">
            <span>Moiré</span>
          </label>
          <label class="toggle-label" title="Auto Refresh">
            <input type="checkbox" id="auto-refresh">
            <span>Auto</span>
          </label>
          <span id="stats">0 boxes</span>
        </div>
      </div>
    `;
  }

  private getStyles(): string {
    return `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        --bg-primary: #1a1a2e;
        --bg-secondary: #16213e;
        --border-color: #0f3460;
        --accent: #667eea;
        --accent-hover: #764ba2;
        --highlight: #4ecdc4;
        --text-primary: #eee;
        --text-secondary: #888;
        --success: #48bb78;
        --warning: #f6ad55;
        --error: #fc8181;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }

      .embed-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        border-radius: 8px;
        overflow: hidden;
      }

      #toolbar {
        height: 36px;
        background: var(--bg-secondary);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
      }

      .toolbar-left, .toolbar-center, .toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .status {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--error);
      }

      .status.connected .status-dot { background: var(--success); }
      .status.connecting .status-dot { 
        background: var(--warning);
        animation: pulse 1s infinite;
      }
      .status.disconnected .status-dot { background: var(--error); }
      .status.error .status-dot { background: var(--error); }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      #toolbar input[type="text"] {
        padding: 4px 8px;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-primary);
        width: 120px;
        font-size: 11px;
      }

      #toolbar input[type="text"]:focus {
        outline: none;
        border-color: var(--accent);
      }

      #toolbar button {
        padding: 4px 10px;
        border: none;
        border-radius: 4px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }

      #toolbar button:hover { background: var(--accent-hover); }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
        transition: background 0.2s;
      }

      .toggle-label:hover { background: rgba(255,255,255,0.1); }

      .toggle-label input[type="checkbox"] {
        width: 14px;
        height: 14px;
        accent-color: var(--accent);
      }

      #stats {
        color: var(--text-secondary);
        font-size: 11px;
      }

      #canvas-container {
        flex: 1;
        overflow: hidden;
        cursor: grab;
        position: relative;
        background: #0a0a15;
      }

      #canvas-container:active { cursor: grabbing; }

      #canvas {
        position: absolute;
        transform-origin: 0 0;
      }

      .box {
        position: absolute;
        border: 2px solid var(--highlight);
        background: rgba(78, 205, 196, 0.1);
        cursor: pointer;
        transition: all 0.15s;
      }

      .box:hover {
        border-color: var(--accent-hover);
        background: rgba(118, 75, 162, 0.2);
        z-index: 100;
        transform: scale(1.02);
      }

      .box.highlighted {
        border-color: #ffe66d;
        background: rgba(255, 230, 109, 0.3);
        box-shadow: 0 0 10px #ffe66d;
      }

      .box.icon-box {
        border-color: #ff9f43;
        background: rgba(255, 159, 67, 0.15);
      }

      .box.icon-box.has-clip {
        background: none;
      }

      .box-label {
        position: absolute;
        left: 2px;
        top: 2px;
        right: 2px;
        font-size: 9px;
        white-space: nowrap;
        color: #fff;
        background: rgba(0,0,0,0.7);
        padding: 1px 3px;
        border-radius: 2px;
        max-width: calc(100% - 4px);
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: 10;
      }

      .box.layer-hidden { display: none !important; }

      #tooltip {
        position: fixed;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        padding: 8px;
        border-radius: 6px;
        font-size: 11px;
        pointer-events: none;
        z-index: 2000;
        display: none;
        max-width: 250px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }

      #minimap {
        position: absolute;
        bottom: 10px;
        right: 10px;
        width: 150px;
        height: 100px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        overflow: hidden;
        opacity: 0.8;
      }

      #minimap:hover { opacity: 1; }

      #minimap-viewport {
        position: absolute;
        border: 2px solid var(--accent);
        background: rgba(102, 126, 234, 0.2);
      }
    `;
  }

  private setupEventListeners() {
    // Search
    const searchInput = this.shadow.getElementById('search') as HTMLInputElement;
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchText(searchInput.value);
    });

    // Fit button
    this.shadow.getElementById('btn-fit')?.addEventListener('click', () => this.fitToContent());

    // Refresh button
    this.shadow.getElementById('btn-refresh')?.addEventListener('click', () => this.refresh());

    // Moiré toggle
    const moireToggle = this.shadow.getElementById('moire-toggle') as HTMLInputElement;
    moireToggle?.addEventListener('change', () => this.setMoireEnabled(moireToggle.checked));

    // Auto-refresh toggle
    const autoRefreshToggle = this.shadow.getElementById('auto-refresh') as HTMLInputElement;
    autoRefreshToggle?.addEventListener('change', () => this.setAutoRefresh(autoRefreshToggle.checked));

    // Pan & Zoom
    this.container?.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.container?.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.container?.addEventListener('mouseup', () => this.onMouseUp());
    this.container?.addEventListener('mouseleave', () => this.onMouseUp());
    this.container?.addEventListener('wheel', (e) => this.onWheel(e));
  }

  private setStatus(state: 'connected' | 'connecting' | 'disconnected' | 'error', text: string) {
    if (!this.statusIndicator) return;
    this.statusIndicator.className = `status ${state}`;
    const textEl = this.statusIndicator.querySelector('.status-text');
    if (textEl) textEl.textContent = text;
  }

  private updateMoireUI() {
    const toggle = this.shadow.getElementById('moire-toggle') as HTMLInputElement;
    if (toggle) toggle.checked = this.moireEnabled;
  }

  private updateAutoRefreshUI() {
    const toggle = this.shadow.getElementById('auto-refresh') as HTMLInputElement;
    if (toggle) toggle.checked = this.autoRefreshEnabled;
  }

  private updateStats() {
    const statsEl = this.shadow.getElementById('stats');
    if (statsEl) {
      const withText = this.data.boxes.filter(b => b.text).length;
      statsEl.textContent = `${this.data.boxes.length} boxes (${withText} OCR)`;
    }
  }

  // ==================== Mouse Events ====================

  private onMouseDown(e: MouseEvent) {
    if (e.target === this.container || e.target === this.canvas) {
      this.isDragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.isDragging) {
      this.panX += e.clientX - this.lastX;
      this.panY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.updateTransform();
      this.updateMinimap();
    }
  }

  private onMouseUp() {
    this.isDragging = false;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, this.zoom * delta));

    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.panX = x - (x - this.panX) * (newZoom / this.zoom);
    this.panY = y - (y - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;

    this.updateTransform();
    this.updateMinimap();
  }

  // ==================== Box Rendering ====================

  private renderBoxes() {
    if (!this.canvas) return;
    this.canvas.innerHTML = '';

    // Background image
    if (this.backgroundImage && this.layerVisibility.background) {
      const bgImg = document.createElement('img');
      bgImg.src = this.backgroundImage;
      bgImg.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;pointer-events:none;opacity:0.8';
      bgImg.onerror = () => console.log('[MoireEmbed] Background image not found');
      this.canvas.appendChild(bgImg);
    }

    // Render boxes
    this.data.boxes.forEach(box => {
      const el = document.createElement('div');
      let className = 'box';
      if (this.highlightedBoxes.has(box.id)) className += ' highlighted';
      if (!this.layerVisibility.components) className += ' layer-hidden';
      
      const isIconBox = !box.text || box.text.trim() === '';
      if (isIconBox) className += ' icon-box';
      
      el.className = className;
      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.dataset.id = String(box.id);

      // Background clipping for icon boxes
      if (isIconBox && this.layerVisibility.icons && this.backgroundImage) {
        el.style.backgroundImage = `url('${this.backgroundImage}')`;
        el.style.backgroundPosition = `-${box.x}px -${box.y}px`;
        el.style.backgroundSize = 'auto';
        el.style.backgroundRepeat = 'no-repeat';
        el.classList.add('has-clip');
      }

      // Text label
      if (box.text && box.text.trim() !== '' && this.layerVisibility.texts) {
        const label = document.createElement('div');
        label.className = 'box-label';
        label.textContent = box.text;
        el.appendChild(label);
      }

      el.addEventListener('click', () => this.onBoxClick(box));
      el.addEventListener('mouseenter', (e) => this.showTooltip(e, box));
      el.addEventListener('mouseleave', () => this.hideTooltip());

      this.canvas.appendChild(el);
    });

    this.updateTransform();
  }

  private onBoxClick(box: DetectionBox) {
    this.dispatchEvent(new CustomEvent('box-click', { detail: { box } }));
  }

  private showTooltip(e: MouseEvent, box: DetectionBox) {
    this.tooltip.innerHTML = `
      <strong>Box #${box.id}</strong><br>
      ${box.x}, ${box.y} • ${box.width}×${box.height}<br>
      ${box.text ? `Text: ${box.text}` : '<em>No OCR</em>'}<br>
      Confidence: ${(box.confidence * 100).toFixed(0)}%
    `;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${e.clientX + 10}px`;
    this.tooltip.style.top = `${e.clientY + 10}px`;
  }

  private hideTooltip() {
    this.tooltip.style.display = 'none';
  }

  private updateTransform() {
    if (this.canvas) {
      this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
  }

  private updateMinimap() {
    if (!this.minimapViewport || this.data.boxes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    this.data.boxes.forEach(b => {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });

    const scale = Math.min(150 / (maxX - minX), 100 / (maxY - minY)) * 0.9;

    const vw = this.container.clientWidth / this.zoom * scale;
    const vh = this.container.clientHeight / this.zoom * scale;
    const vx = (-this.panX / this.zoom - minX) * scale;
    const vy = (-this.panY / this.zoom - minY) * scale;

    this.minimapViewport.style.width = `${vw}px`;
    this.minimapViewport.style.height = `${vh}px`;
    this.minimapViewport.style.left = `${vx}px`;
    this.minimapViewport.style.top = `${vy}px`;
  }
}

// Register custom element
if (typeof customElements !== 'undefined' && !customElements.get('moire-embed')) {
  customElements.define('moire-embed', MoireEmbeddableCanvas);
}

// Export for ES modules
export default MoireEmbeddableCanvas;