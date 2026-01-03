#!/usr/bin/env node

/**
 * Moire Server CLI
 * 
 * Usage:
 *   moire-server [options]
 * 
 * Options:
 *   -p, --port <port>     Server port (default: 8766)
 *   -h, --host <host>     Server host (default: localhost)
 *   -o, --output <dir>    Detection results directory
 *   --no-ocr              Disable OCR
 *   --no-cnn              Disable CNN classification
 *   --help                Show help
 */

const path = require('path');

// Load .env if exists
try {
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (e) {
  // dotenv not required
}

// Parse arguments
const args = process.argv.slice(2);
const config = {
  port: 8766,
  host: 'localhost',
  detectionResultsDir: './detection_results',
  enableOCR: true,
  enableCNN: true,
  enableStreaming: true
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '-p' || arg === '--port') {
    config.port = parseInt(args[++i], 10);
  } else if (arg === '-h' || arg === '--host') {
    config.host = args[++i];
  } else if (arg === '-o' || arg === '--output') {
    config.detectionResultsDir = args[++i];
  } else if (arg === '--no-ocr') {
    config.enableOCR = false;
  } else if (arg === '--no-cnn') {
    config.enableCNN = false;
  } else if (arg === '--help') {
    console.log(`
Moire Server v2.0.0 - Cross-Platform UI Detection

Usage:
  moire-server [options]

Options:
  -p, --port <port>     Server port (default: 8766)
  -h, --host <host>     Server host (default: localhost)
  -o, --output <dir>    Detection results directory (default: ./detection_results)
  --no-ocr              Disable OCR text recognition
  --no-cnn              Disable CNN classification
  --help                Show this help message

Environment Variables:
  OPENAI_API_KEY        OpenAI API key for CNN classification
  MOIRE_PORT            Server port (overridden by --port)
  MOIRE_HOST            Server host (overridden by --host)

Examples:
  moire-server                          Start with defaults
  moire-server -p 9000                  Start on port 9000
  moire-server --no-ocr --no-cnn        Start without ML features

WebSocket API:
  Connect to ws://localhost:8766
  
  Messages:
    { "type": "scan_desktop" }          Capture and analyze desktop
    { "type": "run_ocr" }               Run OCR on detected boxes
    { "type": "start_live" }            Start continuous streaming
    { "type": "stop_live" }             Stop streaming
    { "type": "toggle_moire", "enabled": true }

For Electron embedding, use the canvas-embed.html file.
`);
    process.exit(0);
  }
}

// Apply environment variables
if (process.env.MOIRE_PORT) config.port = parseInt(process.env.MOIRE_PORT, 10);
if (process.env.MOIRE_HOST) config.host = process.env.MOIRE_HOST;
if (process.env.OPENAI_API_KEY) config.openaiApiKey = process.env.OPENAI_API_KEY;

// Start server
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Moire Server v2.0.0                        ║
║              Cross-Platform UI Detection                     ║
╚══════════════════════════════════════════════════════════════╝
`);

console.log('Configuration:');
console.log(`  Port:       ${config.port}`);
console.log(`  Host:       ${config.host}`);
console.log(`  Output:     ${config.detectionResultsDir}`);
console.log(`  OCR:        ${config.enableOCR ? 'enabled' : 'disabled'}`);
console.log(`  CNN:        ${config.enableCNN ? 'enabled' : 'disabled'}`);
console.log(`  OpenAI:     ${config.openaiApiKey ? 'configured' : 'not configured'}`);
console.log('');

// Try to load compiled JS first, fall back to ts-node
async function start() {
  let MoireServer;
  
  try {
    // Try compiled version first
    MoireServer = require('../dist/server/moire-server').MoireServer;
  } catch (e) {
    try {
      // Fall back to ts-node for development
      require('ts-node/register');
      MoireServer = require('../src/server/moire-server').MoireServer;
    } catch (e2) {
      console.error('Error: Could not load MoireServer');
      console.error('Run `npm run build` first or install ts-node for development');
      console.error(e2.message);
      process.exit(1);
    }
  }

  const server = new MoireServer(config);
  
  server.on('started', () => {
    console.log(`Server running on ws://${config.host}:${config.port}`);
    console.log('');
    console.log('Canvas embed available at:');
    console.log(`  file://${path.resolve(__dirname, '../dist/canvas-embed.html')}`);
    console.log('');
    console.log('Press Ctrl+C to stop');
  });

  server.on('client_connected', ({ clientId }) => {
    console.log(`[${new Date().toISOString()}] Client connected: ${clientId}`);
  });

  server.on('client_disconnected', ({ clientId }) => {
    console.log(`[${new Date().toISOString()}] Client disconnected: ${clientId}`);
  });

  server.on('error', (error) => {
    console.error('Server error:', error.message);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });

  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();