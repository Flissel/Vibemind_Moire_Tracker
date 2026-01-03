/**
 * Electron Preload Script for Moire Canvas
 * 
 * This script provides a secure bridge between the renderer (web) context
 * and the main process via IPC.
 * 
 * Usage in your Electron app's preload.js:
 * ```javascript
 * require('@moire/canvas/electron-preload');
 * ```
 * 
 * Or import in your own preload:
 * ```typescript
 * import { setupMoireBridge } from '@moire/canvas/electron-preload';
 * setupMoireBridge();
 * ```
 */

// Types only - actual import happens dynamically
import type { CanvasData, CanvasCommand } from '../types';

// Electron types (will be available at runtime in Electron)
type IpcRenderer = {
  send: (channel: string, data: unknown) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (channel: string, listener: (...args: any[]) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener: (channel: string, listener: (...args: any[]) => void) => void;
};

type ContextBridge = {
  exposeInMainWorld: (apiKey: string, api: unknown) => void;
};

/**
 * API exposed to renderer via contextBridge
 */
export interface MoireElectronAPI {
  /** Send a command from canvas to main process */
  sendCommand: (command: CanvasCommand) => void;
  
  /** Request box data from main process */
  requestBoxData: () => Promise<CanvasData>;
  
  /** Listen for box data updates from main process */
  onBoxDataUpdate: (callback: (data: CanvasData) => void) => () => void;
  
  /** Listen for commands from main process */
  onCommand: (callback: (command: CanvasCommand) => void) => () => void;
  
  /** Get initial config from main process */
  getConfig: () => Promise<{ iconBaseUrl?: string; backgroundImage?: string }>;
}

/**
 * IPC Channel names
 */
export const IPC_CHANNELS = {
  SEND_COMMAND: 'moire:command',
  REQUEST_BOX_DATA: 'moire:request-box-data',
  BOX_DATA_UPDATE: 'moire:box-data-update',
  COMMAND_FROM_MAIN: 'moire:command-from-main',
  GET_CONFIG: 'moire:get-config'
} as const;

// Get Electron modules (only available in Electron preload context)
let contextBridge: ContextBridge | undefined;
let ipcRenderer: IpcRenderer | undefined;

try {
  // Dynamic require to avoid bundling issues
  const electron = require('electron');
  contextBridge = electron.contextBridge;
  ipcRenderer = electron.ipcRenderer;
} catch {
  // Not in Electron environment
  console.warn('@moire/canvas: Electron not available, preload bridge disabled');
}

/**
 * Setup the Moire bridge via contextBridge
 */
export function setupMoireBridge(): void {
  if (!contextBridge || !ipcRenderer) {
    console.warn('@moire/canvas: Cannot setup bridge - not in Electron preload context');
    return;
  }

  const api: MoireElectronAPI = {
    sendCommand: (command: CanvasCommand) => {
      ipcRenderer!.send(IPC_CHANNELS.SEND_COMMAND, command);
    },

    requestBoxData: async (): Promise<CanvasData> => {
      return ipcRenderer!.invoke(IPC_CHANNELS.REQUEST_BOX_DATA) as Promise<CanvasData>;
    },

    onBoxDataUpdate: (callback: (data: CanvasData) => void) => {
      const handler = (_event: unknown, data: CanvasData) => {
        callback(data);
      };
      ipcRenderer!.on(IPC_CHANNELS.BOX_DATA_UPDATE, handler);
      
      // Return cleanup function
      return () => {
        ipcRenderer!.removeListener(IPC_CHANNELS.BOX_DATA_UPDATE, handler);
      };
    },

    onCommand: (callback: (command: CanvasCommand) => void) => {
      const handler = (_event: unknown, command: CanvasCommand) => {
        callback(command);
      };
      ipcRenderer!.on(IPC_CHANNELS.COMMAND_FROM_MAIN, handler);
      
      return () => {
        ipcRenderer!.removeListener(IPC_CHANNELS.COMMAND_FROM_MAIN, handler);
      };
    },

    getConfig: async () => {
      return ipcRenderer!.invoke(IPC_CHANNELS.GET_CONFIG) as Promise<{ iconBaseUrl?: string; backgroundImage?: string }>;
    }
  };

  contextBridge.exposeInMainWorld('moireAPI', api);
}

// Auto-setup when required in Electron preload context
if (typeof process !== 'undefined' && 
    typeof (process as NodeJS.Process & { type?: string }).type === 'string' &&
    (process as NodeJS.Process & { type?: string }).type === 'renderer') {
  setupMoireBridge();
}

// Declare global type for TypeScript
declare global {
  interface Window {
    moireAPI?: MoireElectronAPI;
  }
}