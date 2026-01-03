/**
 * Moiré Canvas - Electron Demo
 *
 * Vollständige Integration des Moiré Detection Canvas in Electron
 * Verwendet jetzt das moire-all-in-one.html Frontend
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let serverProcess = null;

// MoireTracker_v2 Pfad finden
function findMoireTrackerV2Path() {
  const possiblePaths = [
    path.join(__dirname, '..'),  // electron-demo parent = MoireTracker_v2
    path.join(__dirname, '..', '..', 'MoireTracker_v2'),
    process.cwd()
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, 'detection_results')) || 
        fs.existsSync(path.join(p, 'src', 'server', 'moire-server.ts'))) {
      return p;
    }
  }
  return path.join(__dirname, '..');
}

const MOIRE_PATH = findMoireTrackerV2Path();
console.log('[Main] MoireTracker_v2 path:', MOIRE_PATH);

// MoireServer starten (TypeScript/Node.js)
async function startServer() {
  if (serverProcess) {
    console.log('[Main] Server already running');
    return true;
  }
  
  // Check if port is already in use
  const net = require('net');
  const isPortInUse = await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(8765);
  });
  
  if (isPortInUse) {
    console.log('[Main] Port 8765 already in use - using existing server');
    if (mainWindow) {
      mainWindow.webContents.send('moire:bridge-started', { port: 8765, existing: true });
    }
    return true;
  }
  
  // Try to start the MoireServer
  const serverPath = path.join(MOIRE_PATH, 'bin', 'moire-server.js');
  const tsServerPath = path.join(MOIRE_PATH, 'dist', 'index.js');
  
  let serverFile = null;
  if (fs.existsSync(serverPath)) {
    serverFile = serverPath;
  } else if (fs.existsSync(tsServerPath)) {
    serverFile = tsServerPath;
  }
  
  if (!serverFile) {
    console.log('[Main] Server script not found, trying npm start...');
    // Try npm start as fallback
    serverProcess = spawn('npm', ['start'], {
      cwd: MOIRE_PATH,
      env: { ...process.env, PORT: '8765' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
  } else {
    console.log('[Main] Starting MoireServer from:', serverFile);
    serverProcess = spawn('node', [serverFile], {
      cwd: MOIRE_PATH,
      env: { ...process.env, PORT: '8765' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    console.log('[Server]', output);
    
    if ((output.includes('WebSocket') || output.includes('listening') || output.includes('8765')) && mainWindow) {
      mainWindow.webContents.send('moire:bridge-started', { port: 8765 });
    }
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error('[Server Error]', data.toString().trim());
  });
  
  serverProcess.on('exit', (code) => {
    console.log('[Main] Server exited with code', code);
    serverProcess = null;
    if (mainWindow) {
      mainWindow.webContents.send('moire:bridge-stopped', { code });
    }
  });
  
  return true;
}

// Server stoppen
function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    console.log('[Main] Server stopped');
  }
}

// Detection ausführen (via WebSocket message)
async function runDetection() {
  // Detection wird über WebSocket getriggert
  // Das Frontend sendet direkt { type: 'run_detection' } oder { type: 'capture_once' }
  console.log('[Main] Detection triggered via IPC');
  return { success: true, message: 'Detection triggered via WebSocket' };
}

// IPC Handler registrieren
function setupIPC() {
  ipcMain.handle('moire:start-bridge', async () => {
    return startServer();
  });
  
  ipcMain.handle('moire:stop-bridge', async () => {
    stopServer();
    return true;
  });
  
  ipcMain.handle('moire:run-detection', async () => {
    return runDetection();
  });
  
  ipcMain.handle('moire:get-stats', async () => {
    return {
      bridgeRunning: serverProcess !== null,
      wsPort: 8765,
      moirePath: MOIRE_PATH
    };
  });
}

// Fenster erstellen
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'Moiré All-in-One - Electron',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false  // Allow WebSocket from file://
    }
  });

  // Load directly from file (moire-all-in-one style)
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Open DevTools in development
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App starten
app.whenReady().then(() => {
  setupIPC();
  createWindow();
  
  // Server auto-starten nach 1 Sekunde
  setTimeout(() => {
    startServer();
  }, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

console.log('[Main] Moiré All-in-One Electron Demo starting...');