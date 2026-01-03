/**
 * @moire/canvas - Electron Integration
 * 
 * Helpers for embedding Moiré Canvas into existing Electron applications
 * 
 * @example Main Process:
 * ```typescript
 * import { setupMoireIPC, MoireBridgeManager } from '@moire/canvas/electron';
 * 
 * const bridge = new MoireBridgeManager();
 * setupMoireIPC(ipcMain, bridge);
 * ```
 * 
 * @example Preload:
 * ```typescript
 * import { createMoirePreload } from '@moire/canvas/electron';
 * createMoirePreload();
 * ```
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Types
export interface MoireIPCConfig {
  csvDirectory?: string;
  wsPort?: number;
  autoStartBridge?: boolean;
}

export interface BridgeStatus {
  running: boolean;
  port: number;
  pid?: number;
  startedAt?: string;
}

export interface DetectionStats {
  totalBoxes: number;
  withOCR: number;
  lastUpdate: string | null;
  bridgeRunning: boolean;
}

/**
 * Bridge Manager for Main Process
 * Manages the WebSocket bridge server lifecycle
 */
export class MoireBridgeManager {
  private process: ChildProcess | null = null;
  private port: number = 8765;
  private csvDirectory: string;
  private startedAt: string | null = null;
  private onStartedCallbacks: Array<(data: { port: number }) => void> = [];
  private onStoppedCallbacks: Array<(data: { code: number | null }) => void> = [];
  private onErrorCallbacks: Array<(error: Error) => void> = [];

  constructor(config: MoireIPCConfig = {}) {
    this.port = config.wsPort || 8765;
    this.csvDirectory = config.csvDirectory || process.cwd();
    
    if (config.autoStartBridge) {
      this.start();
    }
  }

  /**
   * Start the bridge server
   */
  async start(): Promise<BridgeStatus> {
    if (this.process) {
      return this.getStatus();
    }

    return new Promise((resolve, reject) => {
      // Find the bridge server script
      const serverPath = this.findServerScript();
      
      if (!serverPath) {
        const error = new Error('Bridge server script not found');
        this.onErrorCallbacks.forEach(cb => cb(error));
        reject(error);
        return;
      }

      console.log(`[MoireBridge] Starting server: ${serverPath}`);
      console.log(`[MoireBridge] CSV Directory: ${this.csvDirectory}`);
      console.log(`[MoireBridge] Port: ${this.port}`);

      this.process = spawn('node', [
        serverPath,
        '--port', String(this.port),
        '--csv', this.csvDirectory
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      this.startedAt = new Date().toISOString();

      this.process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log(`[MoireBridge] ${output.trim()}`);
        
        // Detect when server is ready
        if (output.includes('WebSocket') && output.includes('running')) {
          const status = this.getStatus();
          this.onStartedCallbacks.forEach(cb => cb({ port: this.port }));
          resolve(status);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[MoireBridge Error] ${data.toString().trim()}`);
      });

      this.process.on('close', (code: number | null) => {
        console.log(`[MoireBridge] Server exited with code ${code}`);
        this.process = null;
        this.startedAt = null;
        this.onStoppedCallbacks.forEach(cb => cb({ code }));
      });

      this.process.on('error', (err: Error) => {
        console.error(`[MoireBridge] Spawn error:`, err);
        this.onErrorCallbacks.forEach(cb => cb(err));
        reject(err);
      });

      // Timeout if server doesn't start
      setTimeout(() => {
        if (this.process && !this.startedAt) {
          reject(new Error('Bridge server start timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Stop the bridge server
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    return new Promise((resolve) => {
      if (this.process) {
        this.process.on('close', () => resolve());
        this.process.kill('SIGTERM');
        
        // Force kill after timeout
        setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 3000);
      } else {
        resolve();
      }
    });
  }

  /**
   * Get current bridge status
   */
  getStatus(): BridgeStatus {
    return {
      running: this.process !== null,
      port: this.port,
      pid: this.process?.pid,
      startedAt: this.startedAt || undefined
    };
  }

  /**
   * Event handlers
   */
  onStarted(callback: (data: { port: number }) => void): void {
    this.onStartedCallbacks.push(callback);
  }

  onStopped(callback: (data: { code: number | null }) => void): void {
    this.onStoppedCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  /**
   * Find the bridge server script
   */
  private findServerScript(): string | null {
    const candidates = [
      // Development: relative to this file
      path.join(__dirname, '../../bin/moire-server.js'),
      // Installed: node_modules
      path.join(__dirname, '../bin/moire-server.js'),
      // Local tools folder
      path.join(this.csvDirectory, 'tools/websocket-bridge-server.js'),
      // Fallback
      path.join(process.cwd(), 'node_modules/@moire/canvas/bin/moire-server.js'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }
}

/**
 * Setup IPC handlers in Main Process
 */
export function setupMoireIPC(
  ipcMain: Electron.IpcMain,
  bridge: MoireBridgeManager,
  mainWindow?: Electron.BrowserWindow
): void {
  // Start bridge
  ipcMain.handle('moire:start-bridge', async () => {
    try {
      const status = await bridge.start();
      return { success: true, ...status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Stop bridge
  ipcMain.handle('moire:stop-bridge', async () => {
    await bridge.stop();
    return { success: true };
  });

  // Get stats
  ipcMain.handle('moire:get-stats', async () => {
    const status = bridge.getStatus();
    return {
      bridgeRunning: status.running,
      port: status.port,
      totalBoxes: 0,
      withOCR: 0,
      lastUpdate: status.startedAt || null
    };
  });

  // Forward events to renderer
  if (mainWindow) {
    bridge.onStarted((data) => {
      mainWindow.webContents.send('moire:bridge-started', data);
    });

    bridge.onStopped((data) => {
      mainWindow.webContents.send('moire:bridge-stopped', data);
    });

    bridge.onError((error) => {
      mainWindow.webContents.send('moire:bridge-error', { message: error.message });
    });
  }
}

/**
 * Preload script helper - exposes moireAPI to renderer
 */
export function createMoirePreload(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld('moireAPI', {
    // Bridge control
    startBridge: () => ipcRenderer.invoke('moire:start-bridge'),
    stopBridge: () => ipcRenderer.invoke('moire:stop-bridge'),
    
    // Stats
    getStats: () => ipcRenderer.invoke('moire:get-stats'),
    
    // Event listeners
    onBridgeStarted: (callback: (data: { port: number }) => void) => {
      ipcRenderer.on('moire:bridge-started', (_event: Electron.IpcRendererEvent, data: { port: number }) => callback(data));
    },
    onBridgeStopped: (callback: (data: { code: number | null }) => void) => {
      ipcRenderer.on('moire:bridge-stopped', (_event: Electron.IpcRendererEvent, data: { code: number | null }) => callback(data));
    },
    onBridgeError: (callback: (data: { message: string }) => void) => {
      ipcRenderer.on('moire:bridge-error', (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data));
    },
    
    // Cleanup
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('moire:bridge-started');
      ipcRenderer.removeAllListeners('moire:bridge-stopped');
      ipcRenderer.removeAllListeners('moire:bridge-error');
    }
  });
}

/**
 * TypeScript declaration for window.moireAPI
 */
export interface MoireAPI {
  startBridge(): Promise<{ success: boolean; running?: boolean; port?: number; error?: string }>;
  stopBridge(): Promise<{ success: boolean }>;
  getStats(): Promise<DetectionStats>;
  onBridgeStarted(callback: (data: { port: number }) => void): void;
  onBridgeStopped(callback: (data: { code: number | null }) => void): void;
  onBridgeError(callback: (data: { message: string }) => void): void;
  removeAllListeners(): void;
}

// ============================================================================
// Backwards Compatibility Aliases
// ============================================================================

/**
 * @deprecated Use MoireBridgeManager instead
 */
export class MoireElectronService extends MoireBridgeManager {
  constructor(config: MoireIPCConfig = {}) {
    super(config);
    console.warn('[MoireElectronService] is deprecated. Use MoireBridgeManager instead.');
  }
}

/**
 * @deprecated Use createMoirePreload instead
 */
export const exposeMoireAPI = createMoirePreload;

// Default export
export default {
  MoireBridgeManager,
  MoireElectronService, // deprecated alias
  setupMoireIPC,
  createMoirePreload,
  exposeMoireAPI // deprecated alias
};