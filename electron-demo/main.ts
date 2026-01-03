/**
 * Moiré Electron Demo - Main Process
 * 
 * Zeigt wie man MoireElectronService in einer existierenden Electron App verwendet.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { MoireElectronService } from '../src/electron/index';

let mainWindow: BrowserWindow | null = null;
let moireService: MoireElectronService | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load renderer page
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Initialize Moiré Service with main window
  if (moireService && mainWindow) {
    moireService.setMainWindow(mainWindow);
  }
}

// Initialize Moiré Service before window creation
app.whenReady().then(() => {
  // Create the Moiré service
  // Cast to any because electron types are slightly different
  moireService = new MoireElectronService(app as any, ipcMain as any, {
    // Optional: set OpenRouter API key from environment
    openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openRouterModel: 'openai/gpt-4o',
    autoStart: true,  // Auto-start WebSocket bridge
    wsPort: 8765
  });
  
  moireService.initialize();
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (moireService) {
    moireService.shutdown();
  }
});