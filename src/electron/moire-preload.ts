/**
 * Moiré Electron Preload Script
 * 
 * Exponiert die moireAPI sicher dem Renderer Prozess
 * 
 * Verwendung in deinem Electron Preload:
 * ```typescript
 * import { exposeAPI } from '@moire/canvas/electron';
 * exposeAPI();
 * ```
 */

// @ts-ignore - electron is a peer dependency
const { contextBridge, ipcRenderer } = require('electron');

export interface MoireAPI {
  // === Backend Control ===
  startBridge(): Promise<boolean>;
  stopBridge(): Promise<void>;
  runDetection(): Promise<{ success: boolean; boxes: number }>;
  startAutoDetection(intervalMs: number): Promise<boolean>;
  stopAutoDetection(): Promise<void>;
  
  // === Status ===
  getStats(): Promise<{
    bridgeRunning: boolean;
    detectionRunning: boolean;
    lastDetectionTime: number;
    totalDetections: number;
    boxesDetected: number;
    wsPort: number;
  }>;
  getConfig(): Promise<{
    moireTrackerPath: string;
    wsPort: number;
    autoStart: boolean;
    detectionIntervalMs: number;
    openRouterApiKey: string;
    openRouterModel: string;
  }>;
  
  // === Config ===
  setOpenRouterKey(apiKey: string): Promise<boolean>;
  setOpenRouterModel(model: string): Promise<boolean>;
  
  // === Events ===
  onBridgeStarted(callback: (data: { port: number }) => void): () => void;
  onBridgeStopped(callback: (data: { code: number }) => void): () => void;
  onDetectionStarted(callback: () => void): () => void;
  onDetectionComplete(callback: (data: { success: boolean; boxes: number }) => void): () => void;
}

/**
 * Exponiere Moiré API dem Renderer
 */
export function exposeMoireAPI(): void {
  const api: MoireAPI = {
    // === Backend Control ===
    startBridge: () => ipcRenderer.invoke('moire:start-bridge'),
    stopBridge: () => ipcRenderer.invoke('moire:stop-bridge'),
    runDetection: () => ipcRenderer.invoke('moire:run-detection'),
    startAutoDetection: (intervalMs) => ipcRenderer.invoke('moire:start-auto-detection', intervalMs),
    stopAutoDetection: () => ipcRenderer.invoke('moire:stop-auto-detection'),
    
    // === Status ===
    getStats: () => ipcRenderer.invoke('moire:get-stats'),
    getConfig: () => ipcRenderer.invoke('moire:get-config'),
    
    // === Config ===
    setOpenRouterKey: (apiKey) => ipcRenderer.invoke('moire:set-openrouter-key', apiKey),
    setOpenRouterModel: (model) => ipcRenderer.invoke('moire:set-openrouter-model', model),
    
    // === Events ===
    onBridgeStarted: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('moire:bridge-started', handler);
      return () => ipcRenderer.removeListener('moire:bridge-started', handler);
    },
    
    onBridgeStopped: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('moire:bridge-stopped', handler);
      return () => ipcRenderer.removeListener('moire:bridge-stopped', handler);
    },
    
    onDetectionStarted: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('moire:detection-started', handler);
      return () => ipcRenderer.removeListener('moire:detection-started', handler);
    },
    
    onDetectionComplete: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('moire:detection-complete', handler);
      return () => ipcRenderer.removeListener('moire:detection-complete', handler);
    }
  };
  
  contextBridge.exposeInMainWorld('moireAPI', api);
}

// Für TypeScript Deklaration im Renderer
declare global {
  interface Window {
    moireAPI: MoireAPI;
  }
}

export default exposeMoireAPI;