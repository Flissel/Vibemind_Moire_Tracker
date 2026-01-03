/**
 * Electron Main Process Integration
 * 
 * Provides IPC handlers for the detection pipeline.
 * Use this in your Electron main process.
 * 
 * @example
 * ```typescript
 * // In main.js
 * import { setupMoireIPC } from '@moire/canvas/electron';
 * 
 * const win = new BrowserWindow({ ... });
 * setupMoireIPC(win);
 * ```
 */

import { ipcMain, BrowserWindow, desktopCapturer, screen } from 'electron';
import { MoireDetector, createDetector, type DetectionConfig } from '../detection/detector';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface MoireIPCConfig {
  /** Detection configuration */
  detectionConfig?: DetectionConfig;
  /** Directory to save detection results */
  outputDir?: string;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// IPC Channel Names
// ============================================================================

export const MOIRE_IPC_CHANNELS = {
  // From Renderer -> Main
  CAPTURE_SCREEN: 'moire:capture-screen',
  DETECT_SCREEN: 'moire:detect-screen',
  DETECT_IMAGE: 'moire:detect-image',
  LIST_DISPLAYS: 'moire:list-displays',
  GET_CONFIG: 'moire:get-config',
  SET_CONFIG: 'moire:set-config',
  
  // From Main -> Renderer
  DETECTION_RESULT: 'moire:detection-result',
  CAPTURE_RESULT: 'moire:capture-result',
  STATUS_UPDATE: 'moire:status-update',
  ERROR: 'moire:error',
} as const;

// ============================================================================
// MoireIPCHandler Class
// ============================================================================

export class MoireIPCHandler {
  private detector: MoireDetector;
  private config: MoireIPCConfig;
  private registeredWindows = new Set<number>();

  constructor(config: MoireIPCConfig = {}) {
    this.config = {
      outputDir: config.outputDir || './detection_results',
      debug: config.debug ?? false,
      ...config,
    };
    
    this.detector = createDetector(config.detectionConfig);
  }

  // ==================== Setup ====================

  async initialize(): Promise<void> {
    await this.detector.initialize();
    this.setupIPCHandlers();
    this.log('MoireIPCHandler initialized');
  }

  setupForWindow(win: BrowserWindow): void {
    const webContentsId = win.webContents.id;
    
    if (this.registeredWindows.has(webContentsId)) {
      this.log(`Window ${webContentsId} already registered`);
      return;
    }

    this.registeredWindows.add(webContentsId);
    this.log(`Registered window ${webContentsId}`);

    // Handle window close
    win.on('closed', () => {
      this.registeredWindows.delete(webContentsId);
      this.log(`Unregistered window ${webContentsId}`);
    });
  }

  // ==================== IPC Handlers ====================

  private setupIPCHandlers(): void {
    // Capture screen
    ipcMain.handle(MOIRE_IPC_CHANNELS.CAPTURE_SCREEN, async (event, displayId?: number) => {
      try {
        this.sendStatus(event.sender, 'capturing', 'Capturing screen...');
        const result = await this.detector.captureScreen(displayId);
        
        // Convert buffer to base64 for IPC transfer
        const base64Image = `data:image/png;base64,${result.imageBuffer.toString('base64')}`;
        
        this.sendStatus(event.sender, 'done', 'Screen captured');
        return {
          success: true,
          image: base64Image,
          width: result.width,
          height: result.height,
          timestamp: result.timestamp,
        };
      } catch (error) {
        this.sendError(event.sender, error);
        return { success: false, error: String(error) };
      }
    });

    // Detect screen
    ipcMain.handle(MOIRE_IPC_CHANNELS.DETECT_SCREEN, async (event, displayId?: number) => {
      try {
        this.sendStatus(event.sender, 'scanning', 'Running detection...');
        const result = await this.detector.detectFromScreen(displayId);
        
        // Save results if outputDir is configured
        if (this.config.outputDir) {
          await this.saveResults(result);
        }

        this.sendStatus(event.sender, 'done', `Found ${result.boxes.length} boxes`);
        return {
          success: true,
          boxes: result.boxes,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          processingTimeMs: result.processingTimeMs,
          timestamp: result.timestamp,
        };
      } catch (error) {
        this.sendError(event.sender, error);
        return { success: false, error: String(error) };
      }
    });

    // Detect from image file
    ipcMain.handle(MOIRE_IPC_CHANNELS.DETECT_IMAGE, async (event, imagePath: string) => {
      try {
        this.sendStatus(event.sender, 'scanning', 'Running detection on image...');
        const result = await this.detector.detectFromFile(imagePath);
        
        this.sendStatus(event.sender, 'done', `Found ${result.boxes.length} boxes`);
        return {
          success: true,
          boxes: result.boxes,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          processingTimeMs: result.processingTimeMs,
          timestamp: result.timestamp,
        };
      } catch (error) {
        this.sendError(event.sender, error);
        return { success: false, error: String(error) };
      }
    });

    // List displays
    ipcMain.handle(MOIRE_IPC_CHANNELS.LIST_DISPLAYS, async () => {
      try {
        const displays = await this.detector.listDisplays();
        return { success: true, displays };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    // Get config
    ipcMain.handle(MOIRE_IPC_CHANNELS.GET_CONFIG, () => {
      return {
        success: true,
        config: this.detector.getConfig(),
      };
    });

    // Set config
    ipcMain.handle(MOIRE_IPC_CHANNELS.SET_CONFIG, (event, config: Partial<DetectionConfig>) => {
      this.detector.updateConfig(config);
      return { success: true };
    });
  }

  // ==================== Result Saving ====================

  private async saveResults(result: any): Promise<void> {
    const outputDir = this.config.outputDir!;
    
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save as JSON
    const jsonPath = path.join(outputDir, 'detection_results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

    // Save as CSV
    const csvPath = path.join(outputDir, 'component_boxes.csv');
    const csvHeader = 'box_id,box_x,box_y,box_w,box_h,text,confidence,type\n';
    const csvRows = result.boxes.map((box: any) => 
      `${box.id},${box.x},${box.y},${box.width},${box.height},"${(box.text || '').replace(/"/g, '""')}",${box.confidence},${box.type}`
    ).join('\n');
    fs.writeFileSync(csvPath, csvHeader + csvRows);

    this.log(`Results saved to ${outputDir}`);
  }

  // ==================== Status Updates ====================

  private sendStatus(sender: Electron.WebContents, status: string, message: string): void {
    sender.send(MOIRE_IPC_CHANNELS.STATUS_UPDATE, { status, message });
  }

  private sendError(sender: Electron.WebContents, error: any): void {
    sender.send(MOIRE_IPC_CHANNELS.ERROR, { 
      error: String(error),
      stack: error?.stack,
    });
  }

  // ==================== Utility ====================

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[MoireIPC]', ...args);
    }
  }

  // ==================== Cleanup ====================

  async destroy(): Promise<void> {
    await this.detector.terminate();
    ipcMain.removeHandler(MOIRE_IPC_CHANNELS.CAPTURE_SCREEN);
    ipcMain.removeHandler(MOIRE_IPC_CHANNELS.DETECT_SCREEN);
    ipcMain.removeHandler(MOIRE_IPC_CHANNELS.DETECT_IMAGE);
    ipcMain.removeHandler(MOIRE_IPC_CHANNELS.LIST_DISPLAYS);
    ipcMain.removeHandler(MOIRE_IPC_CHANNELS.GET_CONFIG);
    ipcMain.removeHandler(MOIRE_IPC_CHANNELS.SET_CONFIG);
    this.log('MoireIPCHandler destroyed');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let globalHandler: MoireIPCHandler | null = null;

/**
 * Setup Moire IPC handlers for Electron
 * 
 * @example
 * ```typescript
 * // In main.js
 * import { setupMoireIPC } from '@moire/canvas/electron';
 * 
 * app.whenReady().then(async () => {
 *   await setupMoireIPC({ debug: true });
 *   
 *   const win = new BrowserWindow({ ... });
 *   // Canvas will now work via IPC
 * });
 * ```
 */
export async function setupMoireIPC(config: MoireIPCConfig = {}): Promise<MoireIPCHandler> {
  if (globalHandler) {
    console.warn('[MoireIPC] Handler already initialized, returning existing instance');
    return globalHandler;
  }

  globalHandler = new MoireIPCHandler(config);
  await globalHandler.initialize();
  
  return globalHandler;
}

/**
 * Get the global Moire IPC handler
 */
export function getMoireHandler(): MoireIPCHandler | null {
  return globalHandler;
}

/**
 * Destroy the global Moire IPC handler
 */
export async function destroyMoireIPC(): Promise<void> {
  if (globalHandler) {
    await globalHandler.destroy();
    globalHandler = null;
  }
}