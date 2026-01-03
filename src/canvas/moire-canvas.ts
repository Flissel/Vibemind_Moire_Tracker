import {
  DetectionBox,
  Region,
  CanvasData,
  LayerVisibility,
  MoireCanvasConfig,
  CanvasCommand,
  MessageHandler,
  MoireCanvasAPI
} from './types';

/**
 * MoireCanvas Web Component
 * 
 * Cross-platform detection canvas for embedding in Electron apps.
 * 
 * @example
 * ```html
 * <moire-canvas id="canvas"></moire-canvas>
 * <script>
 *   const canvas = document.getElementById('canvas');
 *   canvas.loadBoxData({ boxes: [] });
 * </script>
 * ```
 */
export class MoireCanvas extends HTMLElement implements MoireCanvasAPI {
  private shadow: ShadowRoot;
  private data: CanvasData = { boxes: [], regions: [] };
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private highlightedBoxes = new Set<number>();
  private moireEnabled = false;
  private autoRefreshEnabled = false;
  private autoRefreshTimer: number | null = null;
  private messageHandler: MessageHandler | null = null;

  private layerVisibility: LayerVisibility = {
    components: true,
    icons: true,
    texts: true,
    regions: false,
    background: true
  };

  private config: MoireCanvasConfig = {
    zoom: 1,
    showMinimap: true,
    autoRefreshInterval: 5000,
    iconBaseUrl: ''
  };

  // DOM references
  private canvas!: HTMLDivElement;
  private container!: HTMLDivElement;
  private tooltip!: HTMLDivElement;
  private statsEl!: HTMLSpanElement;
  private statusEl!: HTMLDivElement;
  private minimapViewport!: HTMLDivElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
    this.dispatchEvent(new CustomEvent('ready'));
  }

  disconnectedCallback() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
  }

  static get observedAttributes() {
    return ['background-image', 'icon-base-url', 'auto-refresh'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue === newValue) return;
    
    switch (name) {
      case 'background-image':
        this.config.backgroundImage = newValue;
        this.renderBoxes();
        break;
      case 'icon-base-url':
        this.config.iconBaseUrl = newValue;
        this.renderBoxes();
        break;
      case 'auto-refresh':
        this.setAutoRefresh(newValue === 'true');
        break;
    }
  }

  /**
   * Set message handler for IPC communication
 */
  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  private sendCommand(action: string, value?: string | number | boolean) {
    const cmd: CanvasCommand = { action, value };
    
    if (this.messageHandler) {
      this.messageHandler(cmd);
    }
    
    this.dispatchEvent(new CustomEvent('command', { detail: cmd }));
    this.setStatus(`Command: ${action}`);
  }

  private setStatus(text: string) {
    if (this.statusEl) {
      this.statusEl.textContent = text;
    }
  }

  // ==================== Public API ====================

  loadBoxData(newData: CanvasData) {
    this.data = newData;
    
    // Falls backgroundImage in den Daten enthalten ist, aktualisiere die Config
    if ((newData as any).backgroundImage) {
      this.config.backgroundImage = (newData as any).backgroundImage;
      console.log('[MoireCanvas] Background image updated:', this.config.backgroundImage);
    }
    
    this.renderBoxes();
    this.updateStats();
    this.updateMinimap();
    this.setStatus(`Loaded ${newData.boxes.length} boxes`);
  }

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
    this.updateStats();
    this.updateMinimap();
  }

  panTo(x: number, y: number) {
    this.panX = this.container.clientWidth / 2 - x * this.zoom;
    this.panY = this.container.clientHeight / 2 - y * this.zoom;
    this.updateTransform();
    this.updateMinimap();
  }

  zoomTo(level: number) {
    this.zoom = level;
    this.updateTransform();
    this.updateStats();
    this.updateMinimap();
  }

  highlightBox(boxId: number) {
    this.highlightedBoxes.clear();
    this.highlightedBoxes.add(boxId);
    this.renderBoxes();
  }

  highlightBoxes(boxIds: number[]) {
    this.highlightedBoxes = new Set(boxIds);
    this.renderBoxes();
  }

  clearHighlights() {
    this.highlightedBoxes.clear();
    this.renderBoxes();
  }

  searchText(query: string): DetectionBox[] {
    if (!query) return [];
    
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

    // Pan to first match
    if (results.length > 0) {
      const first = results[0];
      this.panTo(first.x + first.width / 2, first.y + first.height / 2);
    }

    this.dispatchEvent(new CustomEvent('search', { 
      detail: { query, results } 
    }));

    return results;
  }

  setLayerVisibility(layer: keyof LayerVisibility, visible: boolean) {
    this.layerVisibility[layer] = visible;
    this.renderBoxes();
    this.setStatus(`Layer ${layer}: ${visible ? 'visible' : 'hidden'}`);

    this.dispatchEvent(new CustomEvent('layer-change', {
      detail: { layer, visible }
    }));
  }

  setAutoRefresh(enabled: boolean) {
    this.autoRefreshEnabled = enabled;
    
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }

    if (enabled && this.config.autoRefreshInterval) {
      this.autoRefreshTimer = window.setInterval(() => {
        this.sendCommand('refresh_canvas');
        this.dispatchEvent(new CustomEvent('refresh-request'));
      }, this.config.autoRefreshInterval);
    }

    this.setStatus(`Auto-refresh: ${enabled ? 'ON' : 'OFF'}`);
  }

  getMoireEnabled(): boolean {
    return this.moireEnabled;
  }

  setMoireEnabled(enabled: boolean) {
    this.moireEnabled = enabled;
    this.sendCommand('toggle_moire');
    this.dispatchEvent(new CustomEvent('moire-toggle', {
      detail: { enabled }
    }));
  }

  // ==================== Rendering ====================

  private render() {
    this.shadow.innerHTML = `
      <style>${this.getStyles()}</style>
      ${this.getTemplate()}
    `;

    // Cache DOM references
    this.canvas = this.shadow.getElementById('canvas') as HTMLDivElement;
    this.container = this.shadow.getElementById('canvas-container') as HTMLDivElement;
    this.tooltip = this.shadow.getElementById('tooltip') as HTMLDivElement;
    this.statsEl = this.shadow.getElementById('stats') as HTMLSpanElement;
    this.statusEl = this.shadow.getElementById('status-text') as HTMLDivElement;
    this.minimapViewport = this.shadow.getElementById('minimap-viewport') as HTMLDivElement;
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
        --accent: #e94560;
        --accent-hover: #ff6b6b;
        --highlight: #4ecdc4;
        --text-primary: #eee;
        --text-secondary: #888;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      .container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: 'Segoe UI', sans-serif;
      }

      #toolbar {
        height: 40px;
        background: var(--bg-secondary);
        display: flex;
        align-items: center;
        padding: 0 10px;
        gap: 10px;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
      }

      #toolbar input {
        padding: 5px 10px;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-primary);
        width: 200px;
      }

      #toolbar button {
        padding: 5px 15px;
        border: none;
        border-radius: 4px;
        background: var(--accent);
        color: white;
        cursor: pointer;
      }
      #toolbar button:hover { background: var(--accent-hover); }

      #stats {
        margin-left: auto;
        font-size: 12px;
        color: var(--text-secondary);
      }

      .main-area {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      #sidebar {
        width: 260px;
        background: var(--bg-secondary);
        border-right: 1px solid var(--border-color);
        padding: 15px;
        overflow-y: auto;
        flex-shrink: 0;
      }

      #sidebar h3 {
        color: var(--highlight);
        font-size: 12px;
        margin: 15px 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      #sidebar h3:first-child { margin-top: 0; }

      #sidebar button {
        width: 100%;
        padding: 8px;
        margin: 4px 0;
        border: none;
        border-radius: 4px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }
      #sidebar button:hover { background: var(--accent-hover); }

      #sidebar label {
        display: flex;
        align-items: center;
        margin: 6px 0;
        cursor: pointer;
        font-size: 12px;
      }

      #sidebar input[type="checkbox"] {
        margin-right: 8px;
        cursor: pointer;
      }

      .status {
        font-size: 11px;
        color: var(--text-secondary);
        padding: 8px;
        background: var(--bg-primary);
        border-radius: 4px;
        margin-top: 10px;
        min-height: 40px;
      }

      #canvas-container {
        flex: 1;
        overflow: hidden;
        cursor: grab;
        position: relative;
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
        background: rgba(255, 107, 107, 0.2);
        z-index: 100;
        transform: scale(1.02);
      }
      .box.highlighted {
        border-color: #ffe66d;
        background: rgba(255, 230, 109, 0.3);
        box-shadow: 0 0 10px #ffe66d;
      }

      .box-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
        pointer-events: none;
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
        text-shadow: none;
        max-width: calc(100% - 4px);
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: 10;
      }

      .box.icon-box {
        border-color: #ff9f43;
        background: rgba(255, 159, 67, 0.15);
      }
      .box.icon-box.has-clip {
        /* Wenn background-clipping aktiv ist, kein Overlay */
        background: none;
      }
      .box.icon-box:hover {
        border-color: #feca57;
        background: rgba(254, 202, 87, 0.25);
      }
      .box.icon-box.has-clip:hover {
        /* Bei hover leichtes Overlay über dem geclippten Bild */
        background: rgba(254, 202, 87, 0.3);
      }
      .box-icon-placeholder {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 12px;
        opacity: 0.7;
        pointer-events: none;
      }

      .box.layer-hidden { border-color: transparent !important; background: transparent !important; }
      .box-icon.layer-hidden { display: none !important; }
      .box-label.layer-hidden { display: none !important; }

      .region {
        position: absolute;
        border: 2px dashed var(--accent-hover);
        background: rgba(255, 107, 107, 0.05);
        pointer-events: none;
        z-index: -1;
      }
      .region.layer-hidden { display: none !important; }

      #tooltip {
        position: fixed;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        padding: 10px;
        border-radius: 6px;
        font-size: 12px;
        pointer-events: none;
        z-index: 2000;
        display: none;
        max-width: 300px;
      }

      #minimap {
        position: absolute;
        bottom: 10px;
        right: 10px;
        width: 180px;
        height: 120px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        overflow: hidden;
      }

      #minimap-viewport {
        position: absolute;
        border: 2px solid var(--accent);
        background: rgba(233, 69, 96, 0.2);
      }
    `;
  }

  private getTemplate(): string {
    return `
      <div class="container">
        <div id="toolbar">
          <input type="text" id="search" placeholder="Search text...">
          <button id="btn-search">Search</button>
          <button id="btn-fit">Fit</button>
          <span id="stats">Loading...</span>
        </div>

        <div class="main-area">
          <div id="sidebar">
            <h3>Options</h3>
            <label>
              <input type="checkbox" id="auto-refresh">
              Auto Refresh (5s)
            </label>
            <label>
              <input type="checkbox" id="moire-toggle">
              Toggle Moir_e
            </label>

            <h3>Layers</h3>
            <label>
              <input type="checkbox" id="layer-background" checked>
              Background Image
            </label>
            <label>
              <input type="checkbox" id="layer-components" checked>
              Components (Boxes)
            </label>
            <label>
              <input type="checkbox" id="layer-icons" checked>
              Icons
            </label>
            <label>
              <input type="checkbox" id="layer-texts" checked>
              Texts (OCR)
            </label>
            <label>
              <input type="checkbox" id="layer-regions">
              Regions
            </label>

            <h3>Actions</h3>
            <button id="btn-scan-desktop">📷 Scan Desktop</button>
            <button id="btn-scan-window">🪟 Scan Window</button>
            <button id="btn-run-ocr">🔤 Run OCR</button>
            <button id="btn-refresh">🔄 Refresh Canvas</button>

            <h3>Status</h3>
            <div class="status" id="status-text">Ready</div>
          </div>

          <div id="canvas-container">
            <div id="canvas"></div>
            <div id="minimap">
              <div id="minimap-viewport"></div>
            </div>
          </div>
        </div>

        <div id="tooltip"></div>
      </div>
    `;
  }

  private setupEventListeners() {
    // Search
    const searchInput = this.shadow.getElementById('search') as HTMLInputElement;
    const btnSearch = this.shadow.getElementById('btn-search');
    btnSearch?.addEventListener('click', () => this.searchText(searchInput.value));
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchText(searchInput.value);
    });

    // Fit button
    this.shadow.getElementById('btn-fit')?.addEventListener('click', () => this.fitToContent());

    // Refresh button
    this.shadow.getElementById('btn-refresh')?.addEventListener('click', () => {
      this.sendCommand('refresh_canvas');
      this.dispatchEvent(new CustomEvent('refresh-request'));
    });

    // Scan Desktop button
    this.shadow.getElementById('btn-scan-desktop')?.addEventListener('click', () => {
      this.setStatus('Scanning desktop...');
      this.sendCommand('scan_desktop');
      this.dispatchEvent(new CustomEvent('scan-desktop-request'));
    });

    // Scan Window button
    this.shadow.getElementById('btn-scan-window')?.addEventListener('click', () => {
      this.setStatus('Select window to scan...');
      this.sendCommand('scan_window');
      this.dispatchEvent(new CustomEvent('scan-window-request'));
    });

    // Run OCR button
    this.shadow.getElementById('btn-run-ocr')?.addEventListener('click', () => {
      this.setStatus('Running OCR on boxes...');
      this.sendCommand('run_ocr');
      this.dispatchEvent(new CustomEvent('run-ocr-request'));
    });

    // Auto-refresh checkbox
    const autoRefreshCb = this.shadow.getElementById('auto-refresh') as HTMLInputElement;
    autoRefreshCb?.addEventListener('change', () => this.setAutoRefresh(autoRefreshCb.checked));

    // Moir_e toggle
    const moireToggle = this.shadow.getElementById('moire-toggle') as HTMLInputElement;
    moireToggle?.addEventListener('change', () => this.setMoireEnabled(moireToggle.checked));

    // Layer toggles
    ['background', 'components', 'icons', 'texts', 'regions'].forEach(layer => {
      const cb = this.shadow.getElementById(`layer-${layer}`) as HTMLInputElement;
      cb?.addEventListener('change', () => {
        this.setLayerVisibility(layer as keyof LayerVisibility, cb.checked);
      });
    });

    // Pan & Zoom
    this.container?.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.container?.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.container?.addEventListener('mouseup', () => this.onMouseUp());
    this.container?.addEventListener('mouseleave', () => this.onMouseUp());
    this.container?.addEventListener('wheel', (e) => this.onWheel(e));
  }

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
    this.updateStats();
    this.updateMinimap();

    this.dispatchEvent(new CustomEvent('zoom-change', { detail: { zoom: this.zoom } }));
  }

  private renderBoxes() {
    if (!this.canvas) return;
    this.canvas.innerHTML = '';

    // Background image (nur wenn layer sichtbar)
    if (this.config.backgroundImage && this.layerVisibility.background) {
      const bgImg = document.createElement('img');
      bgImg.src = this.config.backgroundImage;
      bgImg.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;pointer-events:none;opacity:0.8';
      bgImg.onerror = () => console.log('Background image not found');
      this.canvas.appendChild(bgImg);
    }

    // Render regions
    if (this.layerVisibility.regions && this.data.regions) {
      this.data.regions.forEach(region => {
        const el = document.createElement('div');
        el.className = 'region';
        el.style.left = `${region.min_x}px`;
        el.style.top = `${region.min_y}px`;
        el.style.width = `${region.max_x - region.min_x}px`;
        el.style.height = `${region.max_y - region.min_y}px`;
        this.canvas.appendChild(el);
      });
    }

    // Render boxes
    this.data.boxes.forEach(box => {
      const el = document.createElement('div');
      let className = 'box';
      if (this.highlightedBoxes.has(box.id)) className += ' highlighted';
      if (!this.layerVisibility.components) className += ' layer-hidden';
      
      // Boxes ohne Text werden als Icon-Boxes markiert
      const isIconBox = !box.text || box.text.trim() === '';
      if (isIconBox) {
        className += ' icon-box';
      }
      
      el.className = className;

      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.dataset.id = String(box.id);

      // Icon (für Boxes ohne Text oder mit explizitem icon_file)
      if (isIconBox && this.layerVisibility.icons) {
        // CSS-Background-Clipping: zeige den entsprechenden Ausschnitt des Hintergrundbildes
        if (this.config.backgroundImage) {
          // Die Box selbst wird zum Fenster in das Hintergrundbild
          el.style.backgroundImage = `url('${this.config.backgroundImage}')`;
          el.style.backgroundPosition = `-${box.x}px -${box.y}px`;
          el.style.backgroundSize = 'auto'; // Originalgröße beibehalten
          el.style.backgroundRepeat = 'no-repeat';
          el.classList.add('has-clip');
        } else if (box.width < 15 && box.height < 15) {
          // Fallback für sehr kleine Boxes ohne Hintergrundbild
          const iconPlaceholder = document.createElement('div');
          iconPlaceholder.className = 'box-icon-placeholder';
          iconPlaceholder.textContent = '・';
          el.appendChild(iconPlaceholder);
        }
      }

      // Text label inside the box (nur für Boxes MIT Text)
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
      Position: (${box.x}, ${box.y})<br>
      Size: ${box.width} x ${box.height}<br>
      ${box.text ? `<br>Text: ${box.text}` : '<em>No OCR text</em>'}<br>
      Confidence: ${(box.confidence * 100).toFixed(1)}%
    `;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${e.clientX + 15}px`;
    this.tooltip.style.top = `${e.clientY + 15}px`;

    this.dispatchEvent(new CustomEvent('box-hover', { detail: { box } }));
  }

  private hideTooltip() {
    this.tooltip.style.display = 'none';
    this.dispatchEvent(new CustomEvent('box-hover', { detail: { box: null } }));
  }

  private updateTransform() {
    if (this.canvas) {
      this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
  }

  private updateStats() {
    if (!this.statsEl) return;
    const processed = this.data.boxes.filter(b => b.text).length;
    this.statsEl.textContent = `Boxes: ${this.data.boxes.length} | OCR: ${processed} | Zoom: ${(this.zoom * 100).toFixed(0)}%`;
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

    const scale = Math.min(180 / (maxX - minX), 120 / (maxY - minY)) * 0.9;

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
if (typeof customElements !== 'undefined' && !customElements.get('moire-canvas')) {
  customElements.define('moire-canvas', MoireCanvas);
}