/**
 * Electron Preload Script Integration
 * 
 * Exposes Moire IPC methods to the renderer process.
 * Use this in your preload script.
 * 
 * @example
 * ```typescript
 * // In preload.js
 * import { exposeMoireAPI } from '@moire/canvas/electron-preload';
 * exposeMoireAPI();
 * 
 * // Then in renderer:
 * window.moireAPI.detectScreen().then(result => console.log(result));
 * ```
 */

import { contextBridge, ipcRenderer } from 'electron';
import { MOIRE_IPC_CHANNELS } from './main-integration';

// ==============================================================================
// Types for Renderer
// ==============================================================================

export interface MoireScreenCaptureResult {
  success: boolean;
  image?: string;
  width?: number;
  height?: number;
  timestamp?: number;
  error?: string;
}

export interface MoireDetectionResult {
  success: boolean;
  boxes?: Array<{
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    confidence: number;
    type: string;
  }>;
  imageWidth?: number;
  imageHeight?: number;
  processingTimeMs?: number;
  timestamp?: number;
  error?: string;
}

export interface MoireDisplay {
  id: string;
  name: string;
}

export interface MoireStatusUpdate {
  status: 'idle' | 'capturing' | 'scanning' | 'done' | 'error';
  message: string;
}

// ==============================================================================
// API Definition
// ==============================================================================

export interface MoireAPI {
  /** Capture the screen without detection */
  captureScreen: (displayId?: number) => Promise<MoireScreenCaptureResult>;
  
  /** Run detection on current screen */
  detectScreen: (displayId?: number) => Promise<MoireDetectionResult>;
  
  /** Run detection on an image file */
  detectImage: (imagePath: string) => Promise<MoireDetectionResult>;
  
  /** List available displays */
  listDisplays: () => Promise<{ success: boolean; displays?: MoireDisplay[]; error?: string }>;
  
  /** Get detection config */
  getConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  
  /** Set detection config */
  setConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
  
  /** Subscribe to status updates */
  onStatus: (callback: (status: MoireStatusUpdate) => void) => () => void;
  
  /** Subscribe to errors */
  onError: (callback: (error: { error: string; stack?: string }) => void) => () => void;
}

// ==============================================================================
// API Implementation
// ==============================================================================

const moireAPI: MoireAPI = {
  captureScreen: (displayId?: number) => 
    ipcRenderer.invoke(MOIRE_IPC_CHANNELS.CAPTURE_SCREEN, displayId),
  
  detectScreen: (displayId?: number) => 
    ipcRenderer.invoke(MOIRE_IPC_CHANNELS.DETECT_SCREEN, displayId),
  
  detectImage: (imagePath: string) => 
    ipcRenderer.invoke(MOIRE_IPC_CHANNELS.DETECT_IMAGE, imagePath),
  
  listDisplays: () => 
    ipcRenderer.invoke(MOIRE_IPC_CHANNELS.LIST_DISPLAYS),
  
  getConfig: () => 
    ipcRenderer.invoke(MOIRE_IPC_CHANNELS.GET_CONFIG),
  
  setConfig: (config: any) => 
    ipcRenderer.invoke(MOIRE_IPC_CHANNELS.SET_CONFIG, config),
  
  onStatus: (callback: (status: MoireStatusUpdate) => void) => {
    const handler = (_event: any, status: MoireStatusUpdate) => callback(status);
    ipcRenderer.on(MOIRE_IPC_CHANNELS.STATUS_UPDATE, handler);
    return () => ipcRenderer.removeListener(MOIRE_IPC_CHANNELS.STATUS_UPDATE, handler);
  },
  
  onError: (callback: (error: { error: string; stack?: string }) => void) => {
    const handler = (_event: any, error: any) => callback(error);
    ipcRenderer.on(MOIRE_IPC_CHANNELS.ERROR, handler);
    return () => ipcRenderer.removeListener(MOIRE_IPC_CHANNELS.ERROR, handler);
  },
};

// ==============================================================================
// Expose Function
// ==============================================================================

/**
 * Expose the Moire API to the renderer process via contextBridge
 * 
 * @example
 * ```typescript
 * // In preload.js
 * import { exposeMoireAPI } from '@moire/canvas/electron-preload';
 * exposeMoireAPI();
 * ```
 */
export function exposeMoireAPI(apiName = 'moireAPI'): void {
  if (process.contextIsolated) {
    try {
      contextBridge.exposeInMainWorld(apiName, moireAPI);
      console.log(`[MoirePreload] Exposed ${apiName} to renderer`);
    } catch (error) {
      console.error('[MoirePreload] Failed to expose API:', error);
    }
  } else {
    // Fallback for non-isolated context
    (window as any)[apiName] = moireAPI;
    console.log(`[MoirePreload] Exposed ${apiName} to window (non-isolated)`);
  }
}

/**
 * Get the Moire API object without exposing it
 * Useful for extending or customizing
 */
export function getMoireAPI(): MoireAPI {
  return moireAPI;
}

// Note: Window.moireAPI type is declared in types.ts