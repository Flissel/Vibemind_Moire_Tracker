/**
 * <moire-live> Web Component
 * Embeddable live detection canvas for Electron applications
 * Features interval slider, real-time updates, and detection visualization
 */

export interface MoireLiveConfig {
  wsUrl: string;           // WebSocket server URL
  interval: number;        // Initial capture interval (1-100s)
  autoStart: boolean;      // Auto-start on connect
  showControls: boolean;   // Show control panel
  showStats: boolean;      // Show statistics panel
  theme: 'light' | 'dark'; // Color theme
}

export class MoireLiveElement extends HTMLElement {
  private shadow: ShadowRoot;
  private ws: WebSocket | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private config: MoireLiveConfig;
  private currentFrame: string = '';
  private boxes: any[] = [];
  private stats = {
    framesProcessed: 0,
    changesDetected: 0,
    totalBoxes: 0,
    connected: false,
    running: false
  };

  static get observedAttributes() {
    return ['ws-url', 'interval', 'auto-start', 'show-controls', 'show-stats', 'theme'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    
    this.config = {
      wsUrl: 'ws://localhost:8765',
      interval: 5,
      autoStart: false,
      showControls: true,
      showStats: true,
      theme: 'dark'
    };

    this.render();
  }

  connectedCallback() {
    this.updateFromAttributes();
    if (this.config.autoStart) {
      this.connect();
    }
  }

  disconnectedCallback() {
    this.disconnect();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue) {
      this.updateFromAttributes();
      this.render();
    }
  }

  private updateFromAttributes() {
    this.config.wsUrl = this.getAttribute('ws-url') || this.config.wsUrl;
    this.config.interval = parseInt(this.getAttribute('interval') || '5');
    this.config.autoStart = this.getAttribute('auto-start') === 'true';
    this.config.showControls = this.getAttribute('show-controls') !== 'false';
    this.config.showStats = this.getAttribute('show-stats') !== 'false';
    this.config.theme = (this.getAttribute('theme') as 'light' | 'dark') || 'dark';
  }

  private render() {
    const isDark = this.config.theme === 'dark';
    const bgColor = isDark ? '#1a1a2e' : '#ffffff';
    const textColor = isDark ? '#ffffff' : '#000000';
    const borderColor = isDark ? '#333' : '#ccc';
    const accentColor = '#4CAF50';

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: ${bgColor};
          color: ${textColor};
          border-radius: 8px;
          overflow: hidden;
        }

        .container {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: ${isDark ? '#16213e' : '#f5f5f5'};
          border-bottom: 1px solid ${borderColor};
        }

        .title {
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #666;
        }

        .status-dot.connected {
          background: ${accentColor};
        }

        .status-dot.running {
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .controls {
          display: ${this.config.showControls ? 'flex' : 'none'};
          gap: 12px;
          align-items: center;
          padding: 12px 16px;
          background: ${isDark ? '#1f1f3a' : '#fafafa'};
          flex-wrap: wrap;
        }

        .control-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .slider-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .slider-label {
          font-size: 12px;
          min-width: 80px;
        }

        input[type="range"] {
          width: 120px;
          height: 4px;
          -webkit-appearance: none;
          background: ${borderColor};
          border-radius: 2px;
          outline: none;
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${accentColor};
          cursor: pointer;
        }

        .slider-value {
          font-size: 12px;
          font-weight: 600;
          min-width: 30px;
        }

        button {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: ${accentColor};
          color: white;
        }

        .btn-primary:hover {
          background: #45a049;
        }

        .btn-secondary {
          background: ${isDark ? '#333' : '#e0e0e0'};
          color: ${textColor};
        }

        .btn-secondary:hover {
          background: ${isDark ? '#444' : '#d0d0d0'};
        }

        .btn-danger {
          background: #f44336;
          color: white;
        }

        .canvas-container {
          flex: 1;
          position: relative;
          overflow: hidden;
          min-height: 300px;
        }

        canvas {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .stats {
          display: ${this.config.showStats ? 'flex' : 'none'};
          gap: 16px;
          padding: 8px 16px;
          background: ${isDark ? '#16213e' : '#f5f5f5'};
          border-top: 1px solid ${borderColor};
          font-size: 11px;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .stat-label {
          color: ${isDark ? '#888' : '#666'};
        }

        .stat-value {
          font-weight: 600;
        }

        .overlay {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: ${isDark ? '#666' : '#999'};
        }

        .overlay-icon {
          font-size: 48px;
          margin-bottom: 8px;
        }
      </style>

      <div class="container">
        <div class="header">
          <div class="title">
            <span class="status-dot ${this.stats.connected ? 'connected' : ''} ${this.stats.running ? 'running' : ''}"></span>
            <span>Moire Live Detection</span>
          </div>
          <div class="control-group">
            <button class="btn-primary connect-btn">${this.stats.connected ? 'Disconnect' : 'Connect'}</button>
          </div>
        </div>

        <div class="controls">
          <div class="slider-container">
            <span class="slider-label">Interval:</span>
            <input type="range" class="interval-slider" min="1" max="100" value="${this.config.interval}">
            <span class="slider-value">${this.config.interval}s</span>
          </div>
          <div class="control-group">
            <button class="btn-secondary start-btn" ${!this.stats.connected ? 'disabled' : ''}>
              ${this.stats.running ? 'Stop' : 'Start'}
            </button>
            <button class="btn-secondary capture-btn" ${!this.stats.connected ? 'disabled' : ''}>Capture</button>
          </div>
        </div>

        <div class="canvas-container">
          <canvas id="detection-canvas"></canvas>
          ${!this.stats.connected ? `
            <div class="overlay">
              <div class="overlay-icon">📡</div>
              <div>Click Connect to start</div>
            </div>
          ` : ''}
        </div>

        <div class="stats">
          <div class="stat-item">
            <span class="stat-label">Frames:</span>
            <span class="stat-value">${this.stats.framesProcessed}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Changes:</span>
            <span class="stat-value">${this.stats.changesDetected}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Boxes:</span>
            <span class="stat-value">${this.stats.totalBoxes}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Status:</span>
            <span class="stat-value">${this.stats.running ? 'Running' : 'Stopped'}</span>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.setupCanvas();
  }

  private setupEventListeners() {
    // Connect button
    const connectBtn = this.shadow.querySelector('.connect-btn');
    connectBtn?.addEventListener('click', () => {
      if (this.stats.connected) {
        this.disconnect();
      } else {
        this.connect();
      }
    });

    // Start/Stop button
    const startBtn = this.shadow.querySelector('.start-btn');
    startBtn?.addEventListener('click', () => {
      if (this.stats.running) {
        this.stopDetection();
      } else {
        this.startDetection();
      }
    });

    // Capture button
    const captureBtn = this.shadow.querySelector('.capture-btn');
    captureBtn?.addEventListener('click', () => {
      this.captureOnce();
    });

    // Interval slider
    const slider = this.shadow.querySelector('.interval-slider') as HTMLInputElement;
    const sliderValue = this.shadow.querySelector('.slider-value');
    slider?.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value;
      if (sliderValue) sliderValue.textContent = `${value}s`;
    });
    slider?.addEventListener('change', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.setInterval(value);
    });
  }

  private setupCanvas() {
    this.canvas = this.shadow.querySelector('#detection-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      // Set initial size
      const container = this.canvas.parentElement;
      if (container) {
        this.canvas.width = container.clientWidth || 800;
        this.canvas.height = container.clientHeight || 600;
      }
    }
  }

  // Public API

  connect() {
    if (this.ws) {
      this.ws.close();
    }

    try {
      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.onopen = () => {
        this.stats.connected = true;
        this.render();
        this.dispatchEvent(new CustomEvent('connected'));
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };

      this.ws.onclose = () => {
        this.stats.connected = false;
        this.stats.running = false;
        this.render();
        this.dispatchEvent(new CustomEvent('disconnected'));
      };

      this.ws.onerror = (error) => {
        console.error('[MoireLive] WebSocket error:', error);
        this.dispatchEvent(new CustomEvent('error', { detail: error }));
      };
    } catch (error) {
      console.error('[MoireLive] Connection failed:', error);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stats.connected = false;
    this.stats.running = false;
    this.render();
  }

  startDetection() {
    this.send({ type: 'start_live', interval: this.config.interval });
  }

  stopDetection() {
    this.send({ type: 'stop_live' });
  }

  captureOnce() {
    this.send({ type: 'capture_once' });
  }

  setInterval(seconds: number) {
    this.config.interval = Math.max(1, Math.min(100, seconds));
    this.send({ type: 'set_interval', interval: this.config.interval });
    this.dispatchEvent(new CustomEvent('interval-changed', { detail: this.config.interval }));
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'detection':
        this.handleDetection(message.data);
        break;
      case 'frame':
        this.handleFrame(message.data);
        break;
      case 'started':
        this.stats.running = true;
        this.render();
        break;
      case 'stopped':
        this.stats.running = false;
        this.render();
        break;
      case 'stats':
        Object.assign(this.stats, message.data);
        this.updateStats();
        break;
    }
  }

  private handleDetection(data: any) {
    this.stats.framesProcessed++;
    if (data.changed) {
      this.stats.changesDetected++;
    }
    this.stats.totalBoxes = data.boxes?.length || 0;
    this.boxes = data.boxes || [];
    
    this.drawBoxes();
    this.updateStats();

    this.dispatchEvent(new CustomEvent('detection', { detail: data }));
  }

  private handleFrame(data: any) {
    if (data.imageData) {
      this.currentFrame = data.imageData;
      this.drawFrame();
    }
  }

  private drawFrame() {
    if (!this.ctx || !this.canvas || !this.currentFrame) return;

    const img = new Image();
    img.onload = () => {
      if (!this.ctx || !this.canvas) return;
      this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      this.drawBoxes();
    };
    img.src = this.currentFrame;
  }

  private drawBoxes() {
    if (!this.ctx || !this.canvas) return;

    // Draw each box
    for (const box of this.boxes) {
      this.ctx.strokeStyle = this.getCategoryColor(box.category);
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Draw label
      if (box.category || box.text) {
        const label = box.category || box.text?.substring(0, 20);
        this.ctx.fillStyle = this.getCategoryColor(box.category);
        this.ctx.font = '10px sans-serif';
        this.ctx.fillText(label, box.x, box.y - 2);
      }
    }
  }

  private getCategoryColor(category?: string): string {
    const colors: { [key: string]: string } = {
      button: '#4CAF50',
      icon: '#2196F3',
      text: '#FF9800',
      image: '#9C27B0',
      input: '#00BCD4',
      checkbox: '#E91E63',
      link: '#3F51B5',
      menu: '#009688',
      unknown: '#666666'
    };
    return colors[category || 'unknown'] || colors.unknown;
  }

  private updateStats() {
    const statsContainer = this.shadow.querySelector('.stats');
    if (!statsContainer) return;

    const items = statsContainer.querySelectorAll('.stat-value');
    if (items.length >= 4) {
      items[0].textContent = String(this.stats.framesProcessed);
      items[1].textContent = String(this.stats.changesDetected);
      items[2].textContent = String(this.stats.totalBoxes);
      items[3].textContent = this.stats.running ? 'Running' : 'Stopped';
    }

    // Update status dot
    const dot = this.shadow.querySelector('.status-dot');
    if (dot) {
      dot.classList.toggle('connected', this.stats.connected);
      dot.classList.toggle('running', this.stats.running);
    }
  }
}

// Register custom element
if (typeof customElements !== 'undefined') {
  customElements.define('moire-live', MoireLiveElement);
}

export default MoireLiveElement;