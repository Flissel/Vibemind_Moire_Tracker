/**
 * Moiré Electron Main Process Service
 * 
 * Steuert das gesamte Backend:
 * - WebSocket Bridge Server
 * - C++ Detection Pipeline
 * - IPC Kommunikation mit Renderer
 * 
 * Verwendung in deiner Electron App:
 * ```typescript
 * import { MoireElectronService } from '@moire/canvas/electron';
 * 
 * const moireService = new MoireElectronService(app, ipcMain);
 * moireService.initialize();
 * ```
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Types für Electron (optional imports da electron ein peer dependency ist)
type IpcMain = {
  handle: (channel: string, handler: (...args: any[]) => any) => void;
  on: (channel: string, handler: (event: any, ...args: any[]) => void) => void;
};

type App = {
  getPath: (name: string) => string;
  on: (event: string, handler: (...args: any[]) => void) => void;
  isPackaged: boolean;
};

type BrowserWindow = {
  webContents: {
    send: (channel: string, ...args: any[]) => void;
  };
};

export interface MoireServiceConfig {
  /** Pfad zum MoireTracker Verzeichnis */
  moireTrackerPath?: string;
  /** WebSocket Port (default: 8765) */
  wsPort?: number;
  /** Auto-Start Backend beim Initialisieren */
  autoStart?: boolean;
  /** Detection interval in ms (for auto-detection) */
  detectionIntervalMs?: number;
  /** OpenRouter API Key für RLAF */
  openRouterApiKey?: string;
  /** OpenRouter Model */
  openRouterModel?: string;
}

export interface MoireServiceStats {
  bridgeRunning: boolean;
  detectionRunning: boolean;
  lastDetectionTime: number;
  totalDetections: number;
  boxesDetected: number;
  wsPort: number;
}

/**
 * Main Process Service für Moiré Integration
 */
export class MoireElectronService {
  private app: App;
  private ipcMain: IpcMain;
  private config: Required<MoireServiceConfig>;
  private bridgeProcess: ChildProcess | null = null;
  private detectionInterval: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  
  private stats: MoireServiceStats = {
    bridgeRunning: false,
    detectionRunning: false,
    lastDetectionTime: 0,
    totalDetections: 0,
    boxesDetected: 0,
    wsPort: 8765
  };

  constructor(app: App, ipcMain: IpcMain, config: MoireServiceConfig = {}) {
    this.app = app;
    this.ipcMain = ipcMain;
    
    // Default config
    this.config = {
      moireTrackerPath: config.moireTrackerPath || this.findMoireTrackerPath(),
      wsPort: config.wsPort ?? 8765,
      autoStart: config.autoStart ?? true,
      detectionIntervalMs: config.detectionIntervalMs ?? 0, // 0 = manual
      openRouterApiKey: config.openRouterApiKey ?? '',
      openRouterModel: config.openRouterModel ?? 'openai/gpt-4o'
    };
    
    this.stats.wsPort = this.config.wsPort;
  }

  /**
   * Finde MoireTracker Pfad automatisch
   */
  private findMoireTrackerPath(): string {
    // Suche in üblichen Lokationen
    const possiblePaths = [
      path.join(process.cwd(), 'MoireTracker'),
      path.join(process.cwd(), '..', 'MoireTracker'),
      path.join(__dirname, '..', '..', '..', 'MoireTracker'),
      path.join(this.app.getPath('userData'), 'MoireTracker'),
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(path.join(p, 'Release'))) {
        return p;
      }
    }
    
    return process.cwd();
  }

  /**
   * Initialisiere Service und registriere IPC Handler
   */
  initialize(mainWindow?: BrowserWindow): void {
    this.mainWindow = mainWindow || null;
    
    // IPC Handler registrieren
    this.registerIPCHandlers();
    
    // App Shutdown Handler
    this.app.on('before-quit', () => {
      this.shutdown();
    });
    
    // Auto-Start wenn konfiguriert
    if (this.config.autoStart) {
      this.startBridge();
    }
    
    console.log('[MoireService] Initialized');
    console.log(`[MoireService] MoireTracker path: ${this.config.moireTrackerPath}`);
  }

  /**
   * Registriere alle IPC Handler
   */
  private registerIPCHandlers(): void {
    // === Backend Control ===
    
    this.ipcMain.handle('moire:start-bridge', async () => {
      return this.startBridge();
    });
    
    this.ipcMain.handle('moire:stop-bridge', async () => {
      return this.stopBridge();
    });
    
    this.ipcMain.handle('moire:run-detection', async () => {
      return this.runDetection();
    });
    
    this.ipcMain.handle('moire:start-auto-detection', async (_event: any, intervalMs: number) => {
      return this.startAutoDetection(intervalMs);
    });
    
    this.ipcMain.handle('moire:stop-auto-detection', async () => {
      return this.stopAutoDetection();
    });
    
    // === Status ===
    
    this.ipcMain.handle('moire:get-stats', async () => {
      return this.getStats();
    });
    
    this.ipcMain.handle('moire:get-config', async () => {
      return this.config;
    });
    
    // === Config ===
    
    this.ipcMain.handle('moire:set-openrouter-key', async (_event: any, apiKey: string) => {
      this.config.openRouterApiKey = apiKey;
      return true;
    });
    
    this.ipcMain.handle('moire:set-openrouter-model', async (_event: any, model: string) => {
      this.config.openRouterModel = model;
      return true;
    });
  }

  /**
   * Starte WebSocket Bridge Server
   */
  async startBridge(): Promise<boolean> {
    if (this.bridgeProcess) {
      console.log('[MoireService] Bridge already running');
      return true;
    }
    
    const bridgePath = path.join(this.config.moireTrackerPath, 'tools', 'websocket-bridge-server.js');
    
    if (!fs.existsSync(bridgePath)) {
      console.error('[MoireService] Bridge script not found:', bridgePath);
      return false;
    }
    
    return new Promise((resolve) => {
      this.bridgeProcess = spawn('node', [bridgePath], {
        cwd: this.config.moireTrackerPath,
        env: { ...process.env, PORT: String(this.config.wsPort) },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.bridgeProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log('[Bridge]', output.trim());
        
        // Check for ready message
        if (output.includes('WebSocket server running')) {
          this.stats.bridgeRunning = true;
          this.notifyRenderer('moire:bridge-started', { port: this.config.wsPort });
          resolve(true);
        }
      });
      
      this.bridgeProcess.stderr?.on('data', (data) => {
        console.error('[Bridge Error]', data.toString().trim());
      });
      
      this.bridgeProcess.on('exit', (code) => {
        console.log('[MoireService] Bridge exited with code', code);
        this.stats.bridgeRunning = false;
        this.bridgeProcess = null;
        this.notifyRenderer('moire:bridge-stopped', { code });
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.stats.bridgeRunning) {
          resolve(false);
        }
      }, 5000);
    });
  }

  /**
   * Stoppe WebSocket Bridge
   */
  async stopBridge(): Promise<void> {
    if (this.bridgeProcess) {
      this.bridgeProcess.kill();
      this.bridgeProcess = null;
      this.stats.bridgeRunning = false;
    }
  }

  /**
   * Führe Detection aus
   */
  async runDetection(): Promise<{ success: boolean; boxes: number }> {
    const exePath = path.join(
      this.config.moireTrackerPath, 
      'Release', 
      'run_detection_ocr_pipeline.exe'
    );
    
    if (!fs.existsSync(exePath)) {
      console.error('[MoireService] Detection exe not found:', exePath);
      return { success: false, boxes: 0 };
    }
    
    this.stats.detectionRunning = true;
    this.notifyRenderer('moire:detection-started', {});
    
    return new Promise((resolve) => {
      const proc = spawn(exePath, [], {
        cwd: path.join(this.config.moireTrackerPath, 'Release'),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let output = '';
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('exit', (code) => {
        this.stats.detectionRunning = false;
        this.stats.totalDetections++;
        this.stats.lastDetectionTime = Date.now();
        
        // Parse box count from output
        const match = output.match(/Loaded (\d+) component boxes/);
        const boxes = match ? parseInt(match[1]) : 0;
        this.stats.boxesDetected = boxes;
        
        const result = { success: code === 0, boxes };
        this.notifyRenderer('moire:detection-complete', result);
        resolve(result);
      });
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.stats.detectionRunning) {
          proc.kill();
          this.stats.detectionRunning = false;
          resolve({ success: false, boxes: 0 });
        }
      }, 60000);
    });
  }

  /**
   * Starte Auto-Detection Loop
   */
  startAutoDetection(intervalMs: number): boolean {
    if (this.detectionInterval) {
      return false; // Already running
    }
    
    this.detectionInterval = setInterval(async () => {
      await this.runDetection();
    }, intervalMs);
    
    console.log(`[MoireService] Auto-detection started (${intervalMs}ms interval)`);
    return true;
  }

  /**
   * Stoppe Auto-Detection
   */
  stopAutoDetection(): void {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
      console.log('[MoireService] Auto-detection stopped');
    }
  }

  /**
   * Hole aktuelle Stats
   */
  getStats(): MoireServiceStats {
    return { ...this.stats };
  }

  /**
   * Sende Nachricht an Renderer
   */
  private notifyRenderer(channel: string, data: any): void {
    if (this.mainWindow) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Shutdown alle Services
   */
  shutdown(): void {
    console.log('[MoireService] Shutting down...');
    this.stopAutoDetection();
    this.stopBridge();
  }

  /**
   * Set main window for IPC
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }
}

/**
 * Factory Funktion
 */
export function createMoireElectronService(
  app: App, 
  ipcMain: IpcMain, 
  config?: MoireServiceConfig
): MoireElectronService {
  return new MoireElectronService(app, ipcMain, config);
}

export default MoireElectronService;