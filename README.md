# Moire Tracker v2

Cross-platform UI detection and analysis system - designed for Electron embedding.

## Features

- **🖥️ Cross-Platform**: Works on Windows, macOS, and Linux
- **🔍 UI Detection**: Detect UI elements using Sobel edge detection + connected components
- **📝 OCR**: Text recognition with tesseract.js
- **🤖 CNN Classification**: Categorize UI elements (button, icon, input, etc.)
- **🌐 WebSocket API**: Easy integration with any frontend
- **⚡ Electron Embeddable**: Ready-to-use canvas component

## Installation

```bash
npm install moire-tracker-v2
```

Or clone and build:

```bash
git clone https://github.com/Vibemind/Vibemind_Desktop_MoireTracker.git
cd Vibemind_Desktop_MoireTracker
npm install
npm run build
```

## Quick Start

### 1. Start the Server

```bash
# Using npx
npx moire-server

# Or after installation
npm start

# With options
moire-server -p 9000 --no-ocr
```

### 2. Connect the Canvas

Open `dist/canvas-embed.html` in a browser or embed in Electron.

## Electron Integration

### Method 1: iframe (Simple)

```html
<!-- In your Electron renderer -->
<iframe 
  id="moire-canvas" 
  src="path/to/canvas-embed.html"
  style="width: 100%; height: 600px; border: none;">
</iframe>

<script>
  const iframe = document.getElementById('moire-canvas');
  
  // Initialize after load
  iframe.onload = () => {
    iframe.contentWindow.postMessage({
      type: 'moire:init',
      wsUrl: 'ws://localhost:8765'
    }, '*');
  };

  // Receive events from canvas
  window.addEventListener('message', (e) => {
    if (e.data.type?.startsWith('moire:')) {
      console.log('Moire event:', e.data);
    }
  });
</script>
```

### Method 2: webview tag (Recommended for Electron)

```html
<webview 
  id="moire-canvas"
  src="path/to/canvas-embed.html"
  style="width: 100%; height: 600px;"
  nodeintegration="false"
  webpreferences="contextIsolation=true">
</webview>

<script>
  const webview = document.getElementById('moire-canvas');
  
  webview.addEventListener('dom-ready', () => {
    webview.send('moire:init', { wsUrl: 'ws://localhost:8765' });
  });

  webview.addEventListener('ipc-message', (e) => {
    if (e.channel.startsWith('moire:')) {
      console.log('Moire event:', e.channel, e.args);
    }
  });
</script>
```

### Method 3: Programmatic API

```typescript
import { MoireServer } from 'moire-tracker-v2/server';
import { JSDetectionPipeline } from 'moire-tracker-v2/detection';
import { OCRService } from 'moire-tracker-v2/ocr';

// Start server
const server = new MoireServer({
  port: 8765,
  enableOCR: true,
  enableCNN: true
});
await server.start();

// Or use detection directly
const detection = new JSDetectionPipeline();
const result = await detection.processImage('screenshot.png');
console.log(`Detected ${result.boxes.length} UI elements`);

// OCR on boxes
const ocr = new OCRService();
await ocr.initialize();
const texts = await ocr.processBoxes(result.boxes, 'screenshot.png');
```

## postMessage API

The canvas embed communicates via postMessage:

### Commands (to canvas)

| Type | Description | Params |
|------|-------------|--------|
| `moire:init` | Initialize with WebSocket URL | `{ wsUrl: string }` |
| `moire:scanDesktop` | Capture and analyze desktop | - |
| `moire:scanWindow` | Capture specific window | `{ windowTitle: string }` |
| `moire:runOCR` | Run OCR on detected boxes | - |
| `moire:toggleMoire` | Toggle moiré pattern filter | `{ enabled: boolean }` |
| `moire:toggleAuto` | Toggle auto-refresh | `{ enabled: boolean }` |
| `moire:setBoxes` | Directly set detection boxes | `{ boxes: DetectionBox[] }` |
| `moire:setBackground` | Set background image | `{ imageData: string }` |
| `moire:zoom` | Set zoom level | `{ level: number }` |
| `moire:pan` | Set pan offset | `{ x: number, y: number }` |
| `moire:getState` | Request current state | - |

### Events (from canvas)

| Type | Description | Data |
|------|-------------|------|
| `moire:loaded` | Canvas initialized | `{ version: string }` |
| `moire:ready` | Ready for commands | `{ version: string }` |
| `moire:connected` | WebSocket connected | - |
| `moire:disconnected` | WebSocket disconnected | - |
| `moire:detection` | Detection results | `{ boxes: [], count: number }` |
| `moire:boxClick` | Box clicked | `{ box: DetectionBox }` |
| `moire:boxHover` | Box hovered | `{ box: DetectionBox }` |
| `moire:ocrComplete` | OCR finished | `{ textCount: number }` |
| `moire:state` | Current state response | `{ connected, boxes, zoom, ... }` |

## WebSocket API

Connect to `ws://localhost:8765` and send JSON messages:

```javascript
const ws = new WebSocket('ws://localhost:8765');

ws.onopen = () => {
  // Handshake
  ws.send(JSON.stringify({ type: 'handshake', clientId: 'my-app' }));
  
  // Scan desktop
  ws.send(JSON.stringify({ type: 'scan_desktop' }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  
  if (msg.type === 'detection_result') {
    console.log('Boxes:', msg.data.boxes);
    console.log('Screenshot:', msg.data.backgroundImage);
  }
};
```

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `handshake` | → Server | Initialize connection |
| `handshake_ack` | ← Server | Connection confirmed |
| `scan_desktop` | → Server | Capture desktop |
| `scan_window` | → Server | Capture window by title |
| `capture_once` | → Server | Single capture |
| `start_live` | → Server | Start streaming |
| `stop_live` | → Server | Stop streaming |
| `run_ocr` | → Server | Run OCR on boxes |
| `run_cnn` | → Server | Run CNN classification |
| `toggle_moire` | → Server | Toggle moiré filter |
| `detection_result` | ← Server | Detection results |
| `ocr_update` | ← Server | Incremental OCR result |
| `ocr_complete` | ← Server | OCR finished |

## Configuration

### Environment Variables

```bash
OPENAI_API_KEY=sk-...    # For CNN classification
MOIRE_PORT=8765          # Server port
MOIRE_HOST=localhost     # Server host
```

### .env File

Create `.env` in your project root:

```
OPENAI_API_KEY=sk-...
MOIRE_PORT=8765
```

## Project Structure

```
MoireTracker_v2/
├── bin/
│   └── moire-server.js      # CLI entry point
├── dist/
│   └── canvas-embed.html    # Electron-embeddable UI
├── src/
│   ├── server/
│   │   └── moire-server.ts  # WebSocket server
│   ├── detection/
│   │   └── js-detection.ts  # Detection pipeline
│   ├── services/
│   │   ├── ocr-service.ts   # OCR with tesseract.js
│   │   └── cnn-service.ts   # CNN classification
│   └── agents/
│       └── agent-team.ts    # Multi-agent system
├── package.json
├── tsconfig.json
└── README.md
```

## UI Components

The canvas includes these controls:

| Button | Function |
|--------|----------|
| 🖥️ Desktop | Capture entire desktop |
| 📋 Windows | Select and capture window |
| 🔤 OCR | Run text recognition |
| 📷 Capture | Single capture |
| Toggle Moiré | Enable/disable moiré filter |
| Toggle Auto | Enable/disable auto-refresh |

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request