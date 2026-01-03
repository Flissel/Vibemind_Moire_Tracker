/**
 * Moiré Canvas - Electron Preload Script
 * 
 * Exponiert die moireAPI dem Renderer sicher via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

// Moiré API dem Renderer exponieren
contextBridge.exposeInMainWorld('moireAPI', {
  // === Backend Control ===
  startBridge: () => ipcRenderer.invoke('moire:start-bridge'),
  stopBridge: () => ipcRenderer.invoke('moire:stop-bridge'),
  runDetection: () => ipcRenderer.invoke('moire:run-detection'),
  
  // === Status ===
  getStats: () => ipcRenderer.invoke('moire:get-stats'),
  
  // === Events ===
  onBridgeStarted: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('moire:bridge-started', handler);
    return () => ipcRenderer.removeListener('moire:bridge-started', handler);
  },
  
  onBridgeStopped: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('moire:bridge-stopped', handler);
    return () => ipcRenderer.removeListener('moire:bridge-stopped', handler);
  }
});

console.log('[Preload] moireAPI exposed to renderer');