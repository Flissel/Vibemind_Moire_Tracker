# Moiré Canvas - Electron Integration Guide

Vollständige Anleitung zur Integration des Moiré Detection Canvas in eine bestehende Electron-Anwendung.

## Übersicht

Das `@moire/canvas` Paket bietet drei Integrationsschichten für Electron:

1. **MoireElectronService** - Main Process Service für Backend-Steuerung
2. **exposeMoireAPI** - Preload Script für sichere IPC-Kommunikation  
3. **`<moire-embed>`** - Web Component für den Renderer

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
├─────────────────────────────────────────────────────────┤
│  Main Process                                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │ MoireElectronService                            │    │
│  │  - WebSocket Bridge Management                  │    │
│  │  - C++ Detection Pipeline                       │    │
│  │  - IPC Handler Registration                     │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  Preload (contextIsolation)                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │ exposeMoireAPI()                                │    │
│  │  → window.moire                              │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  Renderer                                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │ <moire-embed ws-url="ws://localhost:8765"/>     │    │
│  │  + window.moire für Kontrolle                │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install @moire/canvas
```

## Schritt 1: Main Process

```typescript
// main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { MoireElectronService } from '@moire/canvas/electron';

let moireService: MoireElectronService;

app.whenReady().then(() => {
  // Moiré Service erstellen
  moireService = new MoireElectronService(app as any, ipcMain as any, {
    // Pfad zum MoireTracker Verzeichnis (optional, wird auto-detektiert)
    moireTrackerPath: '/path/to/MoireTracker',
    
    // WebSocket Port für die Bridge (default: 8765)
    wsPort: 8765,
    
    // Auto-Start der WebSocket Bridge (default: true)
    autoStart: true,
    
    // OpenRouter API Key für RLAF Training
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: 'openai/gpt-4o'
  });
  
  // IPC Handler registrieren
  moireService.initialize();
  
  // Window erstellen
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  // Main Window setzen für Events
  moireService.setMainWindow(mainWindow);
  
  mainWindow.loadFile('index.html');
});

app.on('before-quit', () => {
  moireService.shutdown();
});
```

## Schritt 2: Preload Script

```typescript
// preload.ts
import { exposeMoireAPI } from '@moire/canvas/electron';

// Moiré API dem Renderer exponieren
exposeMoireAPI();
```

## Schritt 3: Renderer

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Electron App with Moiré</title>
</head>
<body>
  <!-- Detection Canvas einbetten -->
  <moire-embed 
    id="canvas"
    ws-url="ws://localhost:8765"
    show-toolbar="true"
    theme="dark">
  </moire-embed>
  
  <script>
    // Backend über moireAPI steuern
    async function init() {
      // Stats abrufen
      const stats = await window.moireAPI.getStats();
      console.log('Boxes:', stats.boxesDetected);
      
      // Detection ausführen
      const result = await window.moireAPI.runDetection();
      console.log('Detection:', result.success, result.boxes);
      
      // Auto-Detection starten (alle 5 Sekunden)
      await window.moireAPI.startAutoDetection(5000);
      
      // Events abonnieren
      window.moireAPI.onDetectionComplete((data) => {
        console.log('New detection:', data.boxes, 'boxes');
        
        // Canvas aktualisieren
        document.getElementById('canvas').refresh();
      });
    }
    
    init();
  </script>
</body>
</html>
```

## API Referenz

### MoireElectronService (Main Process)

```typescript
class MoireElectronService {
  constructor(app: App, ipcMain: IpcMain, config?: MoireServiceConfig);
  
  // Initialisieren und IPC Handler registrieren
  initialize(mainWindow?: BrowserWindow): void;
  
  // Main Window für Events setzen
  setMainWindow(window: BrowserWindow): void;
  
  // WebSocket Bridge starten
  startBridge(): Promise<boolean>;
  
  // WebSocket Bridge stoppen
  stopBridge(): Promise<void>;
  
  // Einmal-Detection ausführen
  runDetection(): Promise<{ success: boolean; boxes: number }>;
  
  // Auto-Detection starten
  startAutoDetection(intervalMs: number): boolean;
  
  // Auto-Detection stoppen
  stopAutoDetection(): void;
  
  // Stats abrufen
  getStats(): MoireServiceStats;
  
  // Shutdown
  shutdown(): void;
}

interface MoireServiceConfig {
  moireTrackerPath?: string;
  wsPort?: number;
  autoStart?: boolean;
  detectionIntervalMs?: number;
  openRouterApiKey?: string;
  openRouterModel?: string;
}
```

### window.moireAPI (Renderer)

```typescript
interface MoireAPI {
  // === Backend Control ===
  startBridge(): Promise<boolean>;
  stopBridge(): Promise<void>;
  runDetection(): Promise<{ success: boolean; boxes: number }>;
  startAutoDetection(intervalMs: number): Promise<boolean>;
  stopAutoDetection(): Promise<void>;
  
  // === Status ===
  getStats(): Promise<MoireServiceStats>;
  getConfig(): Promise<MoireServiceConfig>;
  
  // === Config ===
  setOpenRouterKey(apiKey: string): Promise<boolean>;
  setOpenRouterModel(model: string): Promise<boolean>;
  
  // === Events ===
  onBridgeStarted(callback: (data: { port: number }) => void): () => void;
  onBridgeStopped(callback: (data: { code: number }) => void): () => void;
  onDetectionStarted(callback: () => void): () => void;
  onDetectionComplete(callback: (data: { success: boolean; boxes: number }) => void): () => void;
}
```

### `<moire-embed>` Web Component

```html
<moire-embed
  ws-url="ws://localhost:8765"   <!-- WebSocket URL -->
  show-toolbar="true"             <!-- Toolbar anzeigen -->
  theme="dark"                    <!-- Theme: dark/light -->
  auto-connect="true"             <!-- Auto-Verbindung -->
></moire-embed>

<script>
  const canvas = document.querySelector('moire-embed');
  
  // Methoden
  canvas.connect();           // WebSocket verbinden
  canvas.disconnect();        // Trennen
  canvas.refresh();           // Daten neu laden
  canvas.setFilter(type);     // Filter setzen ('all', 'icons', 'text')
  canvas.setZoom(level);      // Zoom (0.5 - 3.0)
  canvas.toggleMoire();       // Moiré Overlay togglen
  
  // Events
  canvas.addEventListener('connected', () => {});
  canvas.addEventListener('disconnected', () => {});
  canvas.addEventListener('data-loaded', (e) => console.log(e.detail.boxCount));
  canvas.addEventListener('box-selected', (e) => console.log(e.detail.box));
</script>
```

## OpenRouter Integration für RLAF

Das System verwendet OpenRouter für LLM-gesteuerte Icon-Klassifizierung:

```typescript
// Im Main Process
moireService = new MoireElectronService(app, ipcMain, {
  openRouterApiKey: 'sk-or-...',
  openRouterModel: 'openai/gpt-4o'  // oder 'anthropic/claude-3-sonnet'
});

// Oder später im Renderer
await window.moireAPI.setOpenRouterKey('sk-or-...');
await window.moireAPI.setOpenRouterModel('anthropic/claude-3.5-sonnet');
```

Unterstützte Modelle:
- `openai/gpt-4o` (empfohlen für Vision)
- `openai/gpt-4o-mini`
- `anthropic/claude-3-sonnet`
- `anthropic/claude-3.5-sonnet`
- `google/gemini-pro-vision`

## Vollständiges Beispiel

Siehe [`electron-demo/`](../electron-demo/) für ein vollständiges funktionierendes Beispiel:

```bash
cd moire-canvas/electron-demo
npm install
npm start
```

## Cross-Platform Unterstützung

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| WebSocket Bridge | ✅ | ✅ | ✅ |
| C++ Detection | ✅ | 🔧 | 🔧 |
| Canvas Rendering | ✅ | ✅ | ✅ |
| RLAF Training | ✅ | ✅ | ✅ |

🔧 = Erfordert Kompilierung der C++ Komponenten

## Troubleshooting

### WebSocket verbindet nicht
- Prüfe ob Bridge läuft: `window.moireAPI.getStats()`
- Starte manuell: `window.moireAPI.startBridge()`
- Prüfe Port-Konflikte

### Detection funktioniert nicht
- Stelle sicher dass `run_detection_ocr_pipeline.exe` existiert
- Prüfe `moireTrackerPath` Konfiguration
- Schaue in Logs für Fehler

### Canvas zeigt keine Boxes
- Prüfe WebSocket Verbindung
- Rufe `canvas.refresh()` nach Detection auf
- Prüfe ob `component_boxes.csv` existiert