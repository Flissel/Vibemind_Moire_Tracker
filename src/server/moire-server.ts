/**
 * Moire Server - Cross-Platform WebSocket Server
 * 
 * Features:
 * - WebSocket API auf Port 8766
 * - Desktop/Window Screenshot Capture
 * - JS Detection Pipeline
 * - OCR Integration
 * - CNN Classification
 * - Electron-embedabble Canvas Support
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// WebSocket type definitions
interface WebSocketClient {
  readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

interface WebSocketServerInstance {
  on(event: 'connection', listener: (ws: WebSocketClient, request: unknown) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  close(): void;
}

interface WebSocketServerConstructor {
  new (options: { port: number; host: string }): WebSocketServerInstance;
}

// ScreenshotFunction interface removed - using screenshot-service instead

interface ClientMessage {
  type: string;
  title?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

// WebSocket
let WebSocketServer: WebSocketServerConstructor | null = null;
try {
  const ws = require('ws');
  WebSocketServer = ws.WebSocketServer || ws.Server;
} catch {
  WebSocketServer = null;
}

// Screenshot - use cross-platform service
import { captureScreenshot, isScreenshotAvailable } from '../services/screenshot-service';

// Import services
import { JSDetectionPipeline } from '../detection/js-detection';
import { AdvancedDetectionPipeline, Region, LineGroup } from '../detection/advanced-detection';
import { OCRService, getOCRService } from '../services/ocr-service';
import { CNNClassifier, getCNNClassifier } from '../services/cnn-service';
import { ActiveLearningPipeline, getActiveLearningPipeline, CropResult, UncertainElement } from '../services/active-learning';
import { RLService, getRLService, handleRLMessage, RLWebSocketMessage } from '../services/rl-service';
import { GrpcBridge, getGrpcBridge, ClassifyIconRequest, BatchClassifyResult } from '../services/grpc-bridge';

export interface DetectionBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  confidence?: number;
  category?: string;
}

export interface MoireServerConfig {
  port: number;
  host: string;
  detectionResultsDir: string;
  enableOCR: boolean;
  enableCNN: boolean;
  enableStreaming: boolean;
  streamInterval: number;
  openaiApiKey?: string;
  useAdvancedDetection: boolean;
  autoOCR: boolean;
  autoOCRMinBoxes: number;
  autoCNN: boolean;
  autoCNNMinBoxes: number;
  enableActiveLearning: boolean;
  activeLearningDir: string;
  enableRL: boolean;  // NEU: RL Feature Flag
  pythonBridgeUrl: string;  // NEU: Python Bridge URL für RL
  enableGrpcBridge: boolean;
  grpcBridgeUrl: string;
}

// NEW: Action visualization interface
export interface ActionVisualization {
  type: 'click' | 'double_click' | 'right_click' | 'drag' | 'scroll' | 'type';
  x: number;
  y: number;
  endX?: number;  // For drag actions
  endY?: number;
  button?: string;
  text?: string;  // For type actions
  timestamp: number;
  agentId?: string;
}

const DEFAULT_CONFIG: MoireServerConfig = {
  port: 8766,
  host: 'localhost',
  detectionResultsDir: './detection_results',
  enableOCR: true,
  enableCNN: true,
  enableStreaming: true,
  streamInterval: 2000,
  useAdvancedDetection: true,  // Default to advanced detection
  autoOCR: true,  // NEW: Enable auto-OCR by default
  autoOCRMinBoxes: 1,  // NEW: Run OCR if at least 1 box detected
  autoCNN: true,  // NEU: Enable auto-CNN by default
  autoCNNMinBoxes: 1,  // NEU: Run CNN if at least 1 box detected
  enableActiveLearning: true, // NEU
  activeLearningDir: './training_data', // NEU
  enableRL: true,  // NEU: RL enabled by default
  pythonBridgeUrl: 'http://localhost:8766',  // NEU: Python Bridge URL für RL
  enableGrpcBridge: true,
  grpcBridgeUrl: 'http://localhost:8766'
};

// NEW: State snapshot interface for change detection
interface StateSnapshot {
  version: number;
  timestamp: number;
  boxCount: number;
  boxIds: Set<string>;
  boxTexts: Map<string, string>;
  regionCount: number;
  lineCount: number;
  hash: string;
}

// NEW: UI Context interface for Python agents
export interface UIContext {
  version: number;
  timestamp: number;
  screenDimensions: { width: number; height: number };
  detectionMode: string;
  elements: UIElement[];
  regions: UIRegion[];
  lines: UILine[];
  statistics: {
    totalElements: number;
    elementsWithText: number;
    avgConfidence: number;
  };
}

export interface UIElement {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  text: string | null;
  confidence: number;
  category: string | null;
}

export interface UIRegion {
  id: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  elementCount: number;
  elementIds: string[];
}

export interface UILine {
  id: number;
  regionId: number;
  orientation: string;
  elementCount: number;
  elementIds: string[];
  avgSpacing: number;
}

// NEW: State delta interface
export interface StateDelta {
  added: string[];
  removed: string[];
  modified: string[];
  textChanges: Array<{
    boxId: string;
    oldText: string | null;
    newText: string | null;
  }>;
}

// NEW: Message type for gRPC handlers
interface GrpcWebSocketMessage {
  type: string;
  data?: {
    threshold?: number;
    screenshotBase64?: string;
    icons?: ClassifyIconRequest[];
    [key: string]: unknown;
  };
}

export class MoireServer extends EventEmitter {
  private config: MoireServerConfig;
  private wss: WebSocketServerInstance | null = null;
  private clients: Set<WebSocketClient> = new Set();

  private simpleDetection: JSDetectionPipeline;
  private advancedDetection: AdvancedDetectionPipeline;
  private ocr: OCRService;
  private cnn: CNNClassifier;
  private activeLearning: ActiveLearningPipeline;
  private rlService: RLService;  // NEU
  private grpcBridge: GrpcBridge | null = null;

  private boxes: DetectionBox[] = [];
  private regions: Region[] = [];
  private lines: LineGroup[] = [];
  private lastScreenshot: string | null = null;
  private isStreaming: boolean = false;
  private streamTimer: NodeJS.Timeout | null = null;
  private moireEnabled: boolean = false;
  private windowList: Array<{ title: string; id: string }> = [];

  // NEW: State tracking for change detection
  private previousState: StateSnapshot | null = null;
  private stateVersion: number = 0;

  constructor(config: Partial<MoireServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize both detection pipelines
    this.simpleDetection = new JSDetectionPipeline({
      outputDir: this.config.detectionResultsDir
    });

    this.advancedDetection = new AdvancedDetectionPipeline({
      outputDir: this.config.detectionResultsDir,
      saveDebugImages: true
    });

    this.ocr = getOCRService();
    this.cnn = getCNNClassifier({
      openaiApiKey: this.config.openaiApiKey || process.env.OPENAI_API_KEY
    });

    // NEU: Active Learning Pipeline
    this.activeLearning = getActiveLearningPipeline({
      trainingDir: this.config.activeLearningDir,
      cropDir: path.join(this.config.detectionResultsDir, 'crops'),
      highConfidenceThreshold: 0.8,
      lowConfidenceThreshold: 0.3
    });

    // NEU: RL Service
    this.rlService = getRLService(this.config.pythonBridgeUrl);

    // OCR event forwarding
    this.ocr.on('ocr_update', (data) => {
      this.broadcast({
        type: 'ocr_update',
        updatedBoxes: [data.result].map(r => ({
          id: r.boxId,
          text: r.text
        })),
        progress: data.progress,
        totalTexts: data.processedCount
      });
    });
  }

  async start(): Promise<void> {
    if (!WebSocketServer) {
      throw new Error('ws package not available');
    }

    // Ensure output directory
    if (!fs.existsSync(this.config.detectionResultsDir)) {
      fs.mkdirSync(this.config.detectionResultsDir, { recursive: true });
    }

    // Initialize services
    await this.ocr.initialize();
    await this.cnn.initialize();

    // Initialize gRPC Bridge
    if (this.config.enableGrpcBridge) {
      this.grpcBridge = getGrpcBridge({ pythonHostUrl: this.config.grpcBridgeUrl });
      console.log('[MoireServer] gRPC Bridge initialized');
    }

    // Start WebSocket server
    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host
    });

    this.wss.on('connection', (ws: WebSocketClient, request: unknown) => {
      this.handleConnection(ws, request);
    });

    this.wss.on('error', (error: Error) => {
      console.error('[MoireServer] WebSocket error:', error);
      this.emit('error', error);
    });

    console.log(`[MoireServer] Running on ws://${this.config.host}:${this.config.port}`);
    console.log(`[MoireServer] Features: OCR=${this.config.enableOCR}, CNN=${this.config.enableCNN}, Streaming=${this.config.enableStreaming}, RL=${this.config.enableRL}`);
    
    // Load cached results if available
    await this.loadCachedResults();
    
    this.emit('started');
  }

  stop(): void {
    this.stopStreaming();
    
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    
    this.clients.clear();
    console.log('[MoireServer] Stopped');
    this.emit('stopped');
  }

  private handleConnection(ws: WebSocketClient, request: unknown): void {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[MoireServer] Client connected: ${clientId}`);
    
    this.clients.add(ws);
    this.emit('client_connected', { clientId });

    ws.on('message', async (data: Buffer | string) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        await this.handleMessage(ws, message);
      } catch (error) {
        console.error('[MoireServer] Message parse error:', error);
        this.send(ws, { type: 'error', message: 'Invalid JSON' });
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[MoireServer] Client disconnected: ${clientId}`);
      this.emit('client_disconnected', { clientId });
    });

    ws.on('error', (error: Error) => {
      console.error(`[MoireServer] Client error:`, error);
    });
  }

  private async handleMessage(ws: any, msg: any): Promise<void> {
    console.log(`[MoireServer] Received: ${msg.type}`);

    // NEU: Check for RL messages first
    if (msg.type.startsWith('get_rl_') || msg.type.startsWith('rl_') || msg.type === 'submit_feedback' || msg.type === 'set_exploration_rate' || msg.type === 'set_learning_rate') {
      if (this.config.enableRL) {
        const response = await handleRLMessage(this.rlService, msg as RLWebSocketMessage);
        this.send(ws, response as unknown as Record<string, unknown>);
        return;
      } else {
        this.send(ws, { type: 'error', message: 'RL features are disabled' });
        return;
      }
    }

    switch (msg.type) {
      case 'handshake':
        this.send(ws, {
          type: 'handshake_ack',
          features: {
            ocr: this.config.enableOCR,
            cnn: this.config.enableCNN,
            streaming: this.config.enableStreaming,
            advancedDetection: this.config.useAdvancedDetection,
            actionVisualization: true,
            rl: this.config.enableRL,  // NEU
            activeLearning: this.config.enableActiveLearning,  // NEU
            version: '2.0.0'
          }
        });
        break;

      case 'scan_desktop':
        await this.scanDesktop(ws);
        break;

      case 'scan_window':
        await this.scanWindow(ws, msg.title);
        break;

      case 'list_windows':
        await this.listWindows(ws);
        break;

      case 'capture_once':
        await this.captureOnce(ws);
        break;

      case 'start_live':
        this.startStreaming();
        this.send(ws, { type: 'started' });
        break;

      case 'stop_live':
        this.stopStreaming();
        this.send(ws, { type: 'stopped' });
        break;

      case 'run_ocr':
        await this.runOCR(ws);
        break;

      case 'run_cnn':
        await this.runCNN(ws);
        break;

      case 'toggle_moire':
        this.moireEnabled = msg.enabled ?? !this.moireEnabled;
        this.broadcast({
          type: 'moire_toggle_ack',
          enabled: this.moireEnabled
        });
        break;

      case 'load_cached_results':
        await this.loadCachedResults();
        this.sendDetectionResult(ws);
        break;

      case 'get_detection_results':
        this.sendDetectionResult(ws);
        break;

      case 'set_detection_mode':
        this.config.useAdvancedDetection = msg.mode === 'advanced';
        this.send(ws, {
          type: 'detection_mode_ack',
          mode: this.config.useAdvancedDetection ? 'advanced' : 'simple'
        });
        console.log(`[MoireServer] Detection mode set to: ${this.config.useAdvancedDetection ? 'advanced' : 'simple'}`);
        break;

      // NEW: Handle run_detection (alias for capture_once)
      case 'run_detection':
        await this.captureOnce(ws);
        break;

      // NEW: CNN metrics handler
      case 'cnn_get_metrics':
      case 'cnn_init':
        this.send(ws, {
          type: 'cnn_metrics',
          data: {
            totalClassifications: 0,
            llmEvaluations: 0,
            avgConfidence: 0
          }
        });
        break;

      case 'cnn_trigger_retrain':
        // Stub - CNN retraining would go here
        console.log('[MoireServer] CNN retrain requested (not implemented)');
        this.send(ws, { type: 'cnn_retrain_started' });
        break;

      // NEU: Active Learning Handlers
      case 'get_uncertain_elements':
        await this.getUncertainElements(ws, msg.limit);
        break;

      case 'validate_element':
        await this.validateElement(ws, msg);
        break;

      case 'get_training_stats':
        await this.getTrainingStats(ws);
        break;

      case 'export_training_data':
        await this.exportTrainingData(ws, msg.format);
        break;

      // RL metrics handler - now uses RLService
      case 'rl_get_metrics':
        if (this.config.enableRL) {
          const stats = await this.rlService.getStats();
          this.send(ws, {
            type: 'rl_metrics',
            metrics: {
              totalSteps: stats.totalTransitions,
              totalReward: stats.avgReward * stats.totalEpisodes,
              replayBufferSize: stats.qtableSize,
              epsilon: stats.explorationRate,
              totalEpisodes: stats.totalEpisodes,
              successRate: stats.successRate
            }
          });
        } else {
          this.send(ws, {
            type: 'rl_metrics',
            metrics: {
              totalSteps: 0,
              totalReward: 0,
              replayBufferSize: 0,
              epsilon: 0.8
            }
          });
        }
        break;

      case 'rl_train':
      case 'rl_save':
      case 'rl_reset':
      case 'rl_set_epsilon':
        // Stub handlers for RL commands
        console.log(`[MoireServer] RL command: ${msg.type} (not implemented in v2)`);
        this.send(ws, { type: 'rl_command_ack', command: msg.type });
        break;

      // NEW: Agent status handler (stub - agents run in Python)
      case 'agent_get_status':
        this.send(ws, {
          type: 'agent_status',
          status: {
            isRunning: false,
            plans: 0,
            currentTask: null
          }
        });
        break;

      case 'agent_start_task':
        console.log(`[MoireServer] Agent task requested: ${msg.goal}`);
        // Would need to communicate with Python agent
        this.send(ws, { type: 'agent_task_received', goal: msg.goal });
        break;

      case 'agent_analyze_screen':
        console.log('[MoireServer] Agent analyze screen requested');
        this.send(ws, { type: 'agent_analyze_started' });
        break;

      case 'agent_stop':
        console.log('[MoireServer] Agent stop requested');
        this.send(ws, { type: 'agent_stopped' });
        break;

      case 'set_interval':
        // Update streaming interval
        if (msg.interval && typeof msg.interval === 'number') {
          this.config.streamInterval = msg.interval * 1000;
          console.log(`[MoireServer] Stream interval set to ${msg.interval}s`);
        }
        break;

      // NEW: Handle action reports from agents
      case 'report_action':
        this.handleReportAction(msg);
        break;

      case 'classify_all':
        await this.handleClassifyAll(ws, msg);
        break;

      case 'classify_batch':
        await this.handleClassifyBatch(ws, msg as GrpcWebSocketMessage);
        break;

      case 'get_grpc_status':
        await this.handleGrpcStatus(ws);
        break;

      default:
        console.warn(`[MoireServer] Unknown message type: ${msg.type}`);
        // Don't send error for unknown types - just log it
        break;
    }
  }

  // ==================== Screenshot ====================

  private async captureDesktop(): Promise<Buffer | null> {
    try {
      const buffer = await captureScreenshot();
      return buffer;
    } catch (error) {
      console.error('[MoireServer] Screenshot failed:', error);
      return null;
    }
  }

  private async captureWindow(title: string): Promise<Buffer | null> {
    // Note: screenshot-desktop doesn't directly support window capture
    // We'd need platform-specific solutions or electron's desktopCapturer
    // For now, capture full desktop
    console.warn(`[MoireServer] Window capture not fully supported, capturing desktop`);
    return this.captureDesktop();
  }

  // ==================== Detection ====================

  private async scanDesktop(ws: WebSocketClient): Promise<void> {
    const buffer = await this.captureDesktop();
    if (!buffer) {
      this.send(ws, { type: 'error', message: 'Screenshot failed' });
      return;
    }

    // Fast path: Detection + OCR only, send results immediately
    await this.processScreenshotFast(buffer);
    this.sendDetectionResult(ws);

    // Slow path: CNN + Active Learning in background (don't await)
    this.processScreenshotSlow().catch((err: Error) =>
      console.error('[MoireServer] Background processing failed:', err)
    );
  }

  private async scanWindow(ws: WebSocketClient, title: string): Promise<void> {
    const buffer = await this.captureWindow(title);
    if (!buffer) {
      this.send(ws, { type: 'error', message: `Window capture failed: ${title}` });
      return;
    }

    // Fast path: Detection + OCR only, send results immediately
    await this.processScreenshotFast(buffer);
    this.sendDetectionResult(ws);

    // Slow path: CNN + Active Learning in background (don't await)
    this.processScreenshotSlow().catch((err: Error) =>
      console.error('[MoireServer] Background processing failed:', err)
    );
  }

  private async captureOnce(ws: WebSocketClient): Promise<void> {
    await this.scanDesktop(ws);
  }

  /**
   * Fast path: Detection + OCR only - returns quickly for client response
   */
  private async processScreenshotFast(buffer: Buffer): Promise<void> {
    try {
      // Save screenshot
      const screenshotPath = path.join(this.config.detectionResultsDir, 'desktop_screenshot.png');
      fs.writeFileSync(screenshotPath, buffer);
      this.lastScreenshot = `data:image/png;base64,${buffer.toString('base64')}`;

      // Run detection (choose between simple and advanced)
      if (this.config.useAdvancedDetection) {
        console.log('[MoireServer] Running ADVANCED detection (C++ port)...');
        const result = await this.advancedDetection.processImage(buffer);

        this.boxes = result.boxes.map((box) => ({
          id: `box_${box.id}`,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          confidence: box.confidence
        }));

        this.regions = result.regions;
        this.lines = result.lines;

        console.log(`[MoireServer] Advanced detection complete: ${this.boxes.length} boxes, ${this.regions.length} regions, ${this.lines.length} lines`);
      } else {
        console.log('[MoireServer] Running simple JS detection...');
        const result = await this.simpleDetection.processImage(buffer);

        this.boxes = result.boxes.map((box, idx) => ({
          id: `box_${idx}`,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          confidence: box.confidence
        }));

        this.regions = [];
        this.lines = [];

        console.log(`[MoireServer] Simple detection complete: ${this.boxes.length} boxes`);
      }

      // Auto-OCR if enabled and enough boxes detected
      if (this.config.autoOCR && this.config.enableOCR && this.boxes.length >= this.config.autoOCRMinBoxes) {
        console.log(`[MoireServer] Auto-OCR: Processing ${this.boxes.length} boxes...`);
        await this.runAutoOCR();
      }

      // Save results immediately after detection + OCR
      this.saveResults();

      console.log('[MoireServer] Fast processing complete - results sent to client');
    } catch (error) {
      console.error('[MoireServer] Detection failed:', error);
    }
  }

  /**
   * Slow path: CNN + Active Learning - runs in background after client response
   */
  private async processScreenshotSlow(): Promise<void> {
    try {
      // Auto-CNN if enabled and enough boxes detected
      if (this.config.autoCNN && this.config.enableCNN && this.boxes.length >= this.config.autoCNNMinBoxes) {
        console.log(`[MoireServer] Auto-CNN (background): Classifying ${this.boxes.length} boxes...`);
        await this.runAutoCNN();

        // Save results again after CNN classification
        this.saveResults();
      }

      // Check for state changes and emit event
      await this.checkAndEmitStateChange();

      console.log('[MoireServer] Background processing complete');
    } catch (error: unknown) {
      console.error('[MoireServer] Background processing failed:', error);
    }
  }

  /**
   * Legacy method for streaming - runs full pipeline
   */
  private async processScreenshot(buffer: Buffer): Promise<void> {
    await this.processScreenshotFast(buffer);
    await this.processScreenshotSlow();
  }

  private sendDetectionResult(ws: any): void {
    // Send in moire_detection_result format that frontend expects
    // IMPORTANT: Use 'backgroundImage' field name - Python client expects this!
    this.send(ws, {
      type: 'moire_detection_result',
      boxes: this.boxes,
      regions: this.regions,
      lines: this.lines,
      backgroundImage: this.lastScreenshot,  // Python client expects 'backgroundImage'
      timestamp: Date.now(),
      detectionMode: this.config.useAdvancedDetection ? 'advanced' : 'simple'
    });
  }

  // ==================== Streaming ====================

  private startStreaming(): void {
    if (this.isStreaming) return;
    
    this.isStreaming = true;
    console.log('[MoireServer] Streaming started');

    const tick = async () => {
      if (!this.isStreaming) return;

      const buffer = await this.captureDesktop();
      if (buffer) {
        await this.processScreenshot(buffer);
        this.broadcast({
          type: 'detection',
          data: {
            boxes: this.boxes,
            backgroundImage: this.lastScreenshot,
            timestamp: Date.now()
          }
        });
      }

      if (this.isStreaming) {
        this.streamTimer = setTimeout(tick, this.config.streamInterval);
      }
    };

    tick();
  }

  private stopStreaming(): void {
    this.isStreaming = false;
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    }
    console.log('[MoireServer] Streaming stopped');
  }

  // ==================== OCR ====================

  private async runOCR(ws: WebSocketClient): Promise<void> {
    if (!this.config.enableOCR || this.boxes.length === 0) {
      this.send(ws, {
        type: 'ocr_complete',
        boxes: this.boxes,
        textCount: 0
      });
      return;
    }

    if (!this.lastScreenshot) {
      this.send(ws, { type: 'error', message: 'No screenshot available for OCR' });
      return;
    }

    try {
      console.log(`[MoireServer] Running OCR on ${this.boxes.length} boxes...`);
      
      const results = await this.ocr.processBoxes(this.boxes, this.lastScreenshot);
      
      // Merge OCR results into boxes
      for (const result of results) {
        const box = this.boxes.find(b => b.id === result.boxId);
        if (box) {
          box.text = result.text;
        }
      }

      this.send(ws, {
        type: 'ocr_complete',
        boxes: this.boxes,
        textCount: results.length
      });

      // Save updated results
      this.saveResults();

      console.log(`[MoireServer] OCR complete: ${results.length} texts found`);
    } catch (error) {
      console.error('[MoireServer] OCR failed:', error);
      this.send(ws, { type: 'error', message: 'OCR failed' });
    }
  }

  // ==================== CNN ====================

  private async runCNN(ws: WebSocketClient): Promise<void> {
    if (!this.config.enableCNN || this.boxes.length === 0 || !this.lastScreenshot) {
      this.send(ws, {
        type: 'cnn_complete',
        boxes: this.boxes
      });
      return;
    }

    try {
      console.log(`[MoireServer] Running CNN classification on ${this.boxes.length} boxes...`);
      
      const results = await this.cnn.classifyBoxes(this.boxes, this.lastScreenshot);
      
      // Merge CNN results into boxes
      for (const result of results) {
        const box = this.boxes.find(b => b.id === result.boxId);
        if (box) {
          box.category = result.category;
        }
      }

      this.send(ws, {
        type: 'cnn_complete',
        boxes: this.boxes
      });

      // Save updated results
      this.saveResults();

      console.log(`[MoireServer] CNN complete`);
    } catch (error) {
      console.error('[MoireServer] CNN failed:', error);
      this.send(ws, { type: 'error', message: 'CNN classification failed' });
    }
  }

  // ==================== Window List ====================

  private async listWindows(ws: WebSocketClient): Promise<void> {
    // Platform-specific window enumeration would go here
    // For now, return empty list (would need native modules)
    this.windowList = [];
    
    this.send(ws, {
      type: 'window_list',
      windows: this.windowList
    });
  }

  // ==================== Persistence ====================

  private saveResults(): void {
    const resultsPath = path.join(this.config.detectionResultsDir, 'component_boxes.json');
    try {
      fs.writeFileSync(resultsPath, JSON.stringify({
        boxes: this.boxes,
        regions: this.regions,
        lines: this.lines,
        timestamp: Date.now(),
        count: this.boxes.length,
        detectionMode: this.config.useAdvancedDetection ? 'advanced' : 'simple'
      }, null, 2));
    } catch (error) {
      console.error('[MoireServer] Failed to save results:', error);
    }
  }

  private async loadCachedResults(): Promise<void> {
    const resultsPath = path.join(this.config.detectionResultsDir, 'component_boxes.json');
    const screenshotPath = path.join(this.config.detectionResultsDir, 'desktop_screenshot.png');

    try {
      if (fs.existsSync(resultsPath)) {
        const data = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
        this.boxes = data.boxes || [];
        console.log(`[MoireServer] Loaded ${this.boxes.length} cached boxes`);
      }

      if (fs.existsSync(screenshotPath)) {
        const buffer = fs.readFileSync(screenshotPath);
        this.lastScreenshot = `data:image/png;base64,${buffer.toString('base64')}`;
        console.log(`[MoireServer] Loaded cached screenshot`);
      }
    } catch (error) {
      console.error('[MoireServer] Failed to load cached results:', error);
    }
  }

  // ==================== Communication ====================

  private send(ws: WebSocketClient, data: Record<string, unknown>): void {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(data));
    }
  }

  // NEW: Broadcast action visualization to all clients
  private broadcast(data: Record<string, unknown>): void {
    const message = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  // NEW: Public API
  getBoxes(): DetectionBox[] {
    return this.boxes;
  }

  getScreenshot(): string | null {
    return this.lastScreenshot;
  }

  isStreamingActive(): boolean {
    return this.isStreaming;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  // NEW: Get current UI context for Python agents
  getUIContext(): UIContext {
    return this.createUIContext();
  }
  
  // NEW: Get current state version
  getStateVersion(): number {
    return this.stateVersion;
  }

  // ==================== gRPC Bridge Handlers ====================

  /**
   * Handle classify_all request - classifies all uncertain boxes
   */
  private async handleClassifyAll(ws: WebSocketClient, msg: ClientMessage): Promise<void> {
    if (!this.grpcBridge) {
      this.send(ws, {
        type: 'classify_all_result',
        success: false,
        error: 'gRPC Bridge not enabled'
      });
      return;
    }
    
    try {
      const data = msg.data as { threshold?: number; screenshotBase64?: string } | undefined;
      const confidenceThreshold = data?.threshold ?? 0.7;
      
      // Get current uncertain boxes
      const uncertainBoxes = this.boxes.filter((box: DetectionBox) => 
        !box.category || 
        (box.confidence || 0) < confidenceThreshold
      );
      
      if (uncertainBoxes.length === 0) {
        this.send(ws, {
          type: 'classify_all_result',
          success: true,
          classified: 0,
          message: 'No uncertain boxes to classify'
        });
        return;
      }
      
      console.log(`[MoireServer] Classifying ${uncertainBoxes.length} uncertain boxes via gRPC workers`);
      
      // Convert to ClassifyIconRequest format
      const requests: ClassifyIconRequest[] = await Promise.all(
        uncertainBoxes.map(async (box: DetectionBox) => {
          // Crop the box from screenshot (if available)
          let cropBase64 = '';
          if (data?.screenshotBase64) {
            cropBase64 = await this.cropBoxFromScreenshot(
              data.screenshotBase64,
              box.x, box.y, box.width, box.height
            );
          }
          
          return {
            boxId: box.id,
            cropBase64,
            cnnCategory: box.category,
            cnnConfidence: box.confidence || 0,
            ocrText: box.text,
            bounds: { x: box.x, y: box.y, width: box.width, height: box.height }
          };
        })
      );
      
      // Send to gRPC Bridge
      const result = await this.grpcBridge.classifyBatch(requests);
      
      // Update boxes with new classifications
      this.applyClassificationResults(result);
      
      this.send(ws, {
        type: 'classify_all_result',
        success: true,
        classified: result.successful,
        failed: result.failed,
        processingTimeMs: result.processingTimeMs,
        results: result.results
      });
      
    } catch (error) {
      console.error('[MoireServer] classify_all error:', error);
      this.send(ws, {
        type: 'classify_all_result',
        success: false,
        error: String(error)
      });
    }
  }
  
  /**
   * Handle classify_batch request - classifies specific boxes
   */
  private async handleClassifyBatch(ws: WebSocketClient, message: GrpcWebSocketMessage): Promise<void> {
    if (!this.grpcBridge) {
      this.send(ws, {
        type: 'classify_batch_result',
        success: false,
        error: 'gRPC Bridge not enabled'
      });
      return;
    }
    
    try {
      const data = message.data;
      if (!data?.icons || data.icons.length === 0) {
        this.send(ws, {
          type: 'classify_batch_result',
          success: false,
          error: 'No icons provided'
        });
        return;
      }
      
      const result = await this.grpcBridge.classifyBatch(data.icons);
      
      this.send(ws, {
        type: 'classify_batch_result',
        success: true,
        batchId: result.batchId,
        results: result.results,
        successful: result.successful,
        failed: result.failed,
        processingTimeMs: result.processingTimeMs
      });
      
    } catch (error) {
      console.error('[MoireServer] classify_batch error:', error);
      this.send(ws, {
        type: 'classify_batch_result',
        success: false,
        error: String(error)
      });
    }
  }
  
  /**
   * Handle get_grpc_status request
   */
  private async handleGrpcStatus(ws: WebSocketClient): Promise<void> {
    if (!this.grpcBridge) {
      this.send(ws, {
        type: 'grpc_status',
        enabled: false,
        connected: false
      });
      return;
    }
    
    const connected = await this.grpcBridge.checkConnection();
    const status = this.grpcBridge.getLastStatus();
    
    this.send(ws, {
      type: 'grpc_status',
      enabled: true,
      connected,
      status
    });
  }

  /**
   * Crop a box region from screenshot
   */
  private async cropBoxFromScreenshot(
    screenshotBase64: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<string> {
    try {
      // Use Jimp to crop
      const Jimp = require('jimp');
      
      // Decode base64
      const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      const image = await Jimp.read(buffer);
      
      // Crop with padding
      const padding = 2;
      const cropX = Math.max(0, x - padding);
      const cropY = Math.max(0, y - padding);
      const cropW = Math.min(image.getWidth() - cropX, width + padding * 2);
      const cropH = Math.min(image.getHeight() - cropY, height + padding * 2);
      
      const cropped = image.crop(cropX, cropY, cropW, cropH);
      
      // Resize for API efficiency (max 100x100)
      if (cropped.getWidth() > 100 || cropped.getHeight() > 100) {
        cropped.scaleToFit(100, 100);
      }
      
      const croppedBuffer = await cropped.getBufferAsync(Jimp.MIME_PNG);
      return croppedBuffer.toString('base64');
      
    } catch (error) {
      console.error('[MoireServer] Crop failed:', error);
      return '';
    }
  }

  // Apply classification results to detection boxes
  private applyClassificationResults(result: BatchClassifyResult): void {
    if (!this.boxes || this.boxes.length === 0) return;
    
    const resultsMap = new Map(result.results.map(r => [r.boxId, r]));
    
    for (const box of this.boxes) {
      const classification = resultsMap.get(box.id);
      if (classification) {
        box.category = classification.finalCategory;
        box.confidence = classification.finalConfidence;
        
        // Store validation details for debugging
        (box as any).llmCategory = classification.llmCategory;
        (box as any).cnnLlmMatch = classification.categoriesMatch;
        (box as any).needsReview = classification.needsHumanReview;
      }
    }
    
    console.log(`[MoireServer] Applied ${result.results.length} classifications to boxes`);
  }

  // NEW: State delta calculation
  private calculateStateDelta(oldState: StateSnapshot | null, newState: StateSnapshot): StateDelta {
    const delta: StateDelta = {
      added: [],
      removed: [],
      modified: [],
      textChanges: []
    };
    
    if (!oldState) {
      // First state - all boxes are new
      delta.added = Array.from(newState.boxIds);
      for (const id of newState.boxIds) {
        const text = newState.boxTexts.get(id);
        if (text) {
          delta.textChanges.push({
            boxId: id,
            oldText: null,
            newText: text
          });
        }
      }
      return delta;
    }

    // Find added boxes
    for (const box of this.boxes) {
      if (!oldState.boxIds.has(box.id)) {
        delta.added.push(box.id);
      }
    }
    
    // Find removed boxes  
    for (const oldId of oldState.boxIds) {
      if (!this.boxes.find(b => b.id === oldId)) {
        delta.removed.push(oldId);
      }
    }
    
    // Find text changes
    for (const box of this.boxes) {
      const oldText = oldState.boxTexts.get(box.id);
      const newText = box.text;
      
      if (oldText !== newText) {
        if (oldState.boxIds.has(box.id)) {
          delta.textChanges.push({
            boxId: box.id,
            oldText: oldText || null,
            newText: newText || null
          });
          if (!delta.modified.includes(box.id)) {
            delta.modified.push(box.id);
          }
        }
      }
    }
    
    return delta;
  }

  // ==================== Active Learning Methods ====================

  // NEU: Get uncertain elements for validation
  private async getUncertainElements(ws: WebSocketClient, limit: number = 10): Promise<void> {
    try {
      const elements = this.activeLearning.getUncertainQueue(limit);
      
      this.send(ws, {
        type: 'uncertain_elements',
        elements,
        totalQueued: this.activeLearning.getQueueSize()
      });
    } catch (error) {
      console.error('[MoireServer] Failed to get uncertain elements:', error);
      this.send(ws, { type: 'error', message: 'Failed to get uncertain elements' });
    }
  }

  // NEU: Validate element with corrected category
  private async validateElement(ws: WebSocketClient, msg: ClientMessage): Promise<void> {
    try {
      const { boxId, correctedCategory, validatorId } = msg as { boxId?: string; correctedCategory?: string; validatorId?: string };
      
      if (!boxId || !correctedCategory) {
        this.send(ws, { type: 'error', message: 'Missing boxId or correctedCategory' });
        return;
      }

      const element = this.activeLearning.getUncertainQueue().find((e: UncertainElement) => e.boxId === boxId);
      if (!element) {
        this.send(ws, { type: 'error', message: 'Element not found in queue' });
        return;
      }

      // Save with corrected category
      await this.activeLearning.validateAndSave(boxId, correctedCategory, validatorId);
      
      this.send(ws, {
        type: 'element_validated',
        boxId,
        correctedCategory,
        remainingQueue: this.activeLearning.getQueueSize()
      });

      console.log(`[MoireServer] Element ${boxId} validated as '${correctedCategory}'`);
    } catch (error) {
      console.error('[MoireServer] Validation failed:', error);
      this.send(ws, { type: 'error', message: 'Validation failed' });
    }
  }

  // NEU: Get training data statistics
  private async getTrainingStats(ws: WebSocketClient): Promise<void> {
    try {
      const stats = await this.activeLearning.getTrainingStats();
      
      this.send(ws, {
        type: 'training_stats',
        stats
      });
    } catch (error) {
      console.error('[MoireServer] Failed to get training stats:', error);
      this.send(ws, { type: 'error', message: 'Failed to get training stats' });
    }
  }

  // NEU: Export training data
  private async exportTrainingData(ws: WebSocketClient, format: string = 'json'): Promise<void> {
    try {
      const exportPath = await this.activeLearning.exportDataset(format);
      
      this.send(ws, {
        type: 'training_data_exported',
        path: exportPath,
        format
      });
    } catch (error) {
      console.error('[MoireServer] Export failed:', error);
      this.send(ws, { type: 'error', message: 'Export failed' });
    }
  }

  // ==================== Action & State Methods ====================

  // NEW: Handle action reports from agents
  private handleReportAction(msg: ClientMessage): void {
    const action: ActionVisualization = {
      type: (msg.actionType as ActionVisualization['type']) || 'click',
      x: (msg.x as number) || 0,
      y: (msg.y as number) || 0,
      endX: msg.endX as number | undefined,
      endY: msg.endY as number | undefined,
      button: msg.button as string | undefined,
      text: msg.text as string | undefined,
      timestamp: Date.now(),
      agentId: msg.agentId as string | undefined
    };
    
    // Broadcast action visualization to all clients
    this.broadcast({
      type: 'action_visualization',
      action
    });
    
    console.log(`[MoireServer] Action reported: ${action.type} at (${action.x}, ${action.y})`);
  }

  // ==================== Auto Processing Methods ====================

  // NEW: Auto-OCR method (internal, doesn't send to specific client)
  private async runAutoOCR(): Promise<void> {
    if (!this.config.enableOCR || this.boxes.length === 0 || !this.lastScreenshot) {
      return;
    }

    try {
      const results = await this.ocr.processBoxes(this.boxes, this.lastScreenshot);
      
      // Merge OCR results into boxes
      for (const result of results) {
        const box = this.boxes.find(b => b.id === result.boxId);
        if (box) {
          box.text = result.text;
        }
      }

      console.log(`[MoireServer] Auto-OCR complete: ${results.length} texts found`);
    } catch (error) {
      console.error('[MoireServer] Auto-OCR failed:', error);
    }
  }

  // NEU: Auto-CNN method (internal, doesn't send to specific client)
  private async runAutoCNN(): Promise<void> {
    if (!this.config.enableCNN || this.boxes.length === 0 || !this.lastScreenshot) {
      return;
    }

    try {
      const results = await this.cnn.classifyBoxes(this.boxes, this.lastScreenshot);
      
      // Merge CNN results into boxes
      let categorizedCount = 0;
      for (const result of results) {
        const box = this.boxes.find(b => b.id === result.boxId);
        if (box) {
          box.category = result.category;
          box.confidence = result.confidence; // NEU: Confidence auch speichern
          categorizedCount++;
        }
      }

      // Log category distribution
      const categories: Record<string, number> = {};
      for (const box of this.boxes) {
        const cat = box.category || 'unknown';
        categories[cat] = (categories[cat] || 0) + 1;
      }
      
      console.log(`[MoireServer] Auto-CNN complete: ${categorizedCount} boxes classified`);
      console.log(`[MoireServer] Category distribution: ${JSON.stringify(categories)}`);

      // NEU: Active Learning Pipeline ausführen
      if (this.config.enableActiveLearning && this.lastScreenshot) {
        await this.runActiveLearning();
      }
    } catch (error) {
      console.error('[MoireServer] Auto-CNN failed:', error);
    }
  }

  // NEU: Active Learning Pipeline ausführen
  private async runActiveLearning(): Promise<void> {
    if (!this.config.enableActiveLearning || this.boxes.length === 0 || !this.lastScreenshot) {
      return;
    }

    try {
      console.log(`[MoireServer] Running Active Learning on ${this.boxes.length} boxes...`);
      
      const result = await this.activeLearning.process(this.boxes, this.lastScreenshot);
      
      console.log(`[MoireServer] Active Learning complete:`);
      console.log(`  - Saved to training: ${result.saved}`);
      console.log(`  - Queued for review: ${result.queued}`);
      console.log(`  - Skipped (low conf): ${result.skipped}`);

      // Broadcast update to clients
      this.broadcast({
        type: 'active_learning_update',
        stats: result,
        queueSize: this.activeLearning.getQueueSize()
      });
    } catch (error) {
      console.error('[MoireServer] Active Learning failed:', error);
    }
  }

  // NEW: Check for state changes and emit event
  private async checkAndEmitStateChange(): Promise<void> {
    // Create new state snapshot
    const newState: StateSnapshot = {
      version: this.stateVersion + 1,
      timestamp: Date.now(),
      boxCount: this.boxes.length,
      boxIds: new Set(this.boxes.map(b => b.id)),
      boxTexts: new Map(this.boxes.map(b => [b.id, b.text || ''])),
      regionCount: this.regions.length,
      lineCount: this.lines.length,
      hash: this.calculateStateHash()
    };
    
    // Check if state changed
    if (!this.previousState || this.previousState.hash !== newState.hash) {
      const delta = this.calculateStateDelta(this.previousState, newState);
      
      // Update state
      this.stateVersion = newState.version;
      this.previousState = newState;
      
      // Emit state change event
      this.emit('state_change', {
        version: newState.version,
        timestamp: newState.timestamp,
        delta,
        context: this.createUIContext()
      });
      
      // Broadcast to connected clients
      this.broadcast({
        type: 'state_change',
        version: newState.version,
        timestamp: newState.timestamp,
        delta,
        boxCount: newState.boxCount,
        uiContext: this.createUIContext()  // NEU: Vollständigen Context mitsenden
      });
      
      console.log(`[MoireServer] State changed: v${newState.version}, +${delta.added.length}/-${delta.removed.length} boxes`);
    }
  }

  // NEW: Calculate state hash for change detection
  private calculateStateHash(): string {
    const data = {
      boxCount: this.boxes.length,
      boxIds: this.boxes.map(b => b.id).sort(),
      texts: this.boxes.map(b => `${b.id}:${b.text || ''}`).sort(),
      categories: this.boxes.map(b => `${b.id}:${b.category || ''}`).sort()
    };
    // Simple hash - in production use crypto
    return JSON.stringify(data).split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0).toString(16);
  }

  // NEW: Create structured UI context for Python agents
  private createUIContext(): UIContext {
    const elements: UIElement[] = this.boxes.map(box => ({
      id: box.id,
      type: box.category || 'unknown',
      bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
      center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      text: box.text || null,
      confidence: box.confidence || 0,
      category: box.category || null
    }));
    
    const regions: UIRegion[] = this.regions.map(region => ({
      id: region.id,
      bounds: { minX: region.minX, minY: region.minY, maxX: region.maxX, maxY: region.maxY },
      elementCount: region.boxIndices.length,
      elementIds: region.boxIndices.map(i => this.boxes[i]?.id).filter(Boolean) as string[]
    }));
    
    const lines: UILine[] = this.lines.map(line => ({
      id: line.id,
      regionId: line.regionId,
      orientation: line.orientation,
      elementCount: line.boxIndices.length,
      elementIds: line.boxIndices.map(i => this.boxes[i]?.id).filter(Boolean) as string[],
      avgSpacing: line.avgSpacing
    }));
    
    const elementsWithText = elements.filter(e => e.text).length;
    const avgConfidence = elements.length > 0 
      ? elements.reduce((sum, e) => sum + e.confidence, 0) / elements.length 
      : 0;
    
    return {
      version: this.stateVersion,
      timestamp: Date.now(),
      screenDimensions: { width: 1920, height: 1080 }, // TODO: Get actual dimensions
      detectionMode: this.config.useAdvancedDetection ? 'advanced' : 'simple',
      elements,
      regions,
      lines,
      statistics: {
        totalElements: elements.length,
        elementsWithText,
        avgConfidence
      }
    };
  }
}

// CI Entry Point
export async function startServer(config?: Partial<MoireServerConfig>): Promise<MoireServer> {
  const server = new MoireServer(config);
  await server.start();
  return server;
}

export default MoireServer;

// Auto-start when run directly with ts-node or node
if (require.main === module) {
  console.log('[MoireServer] Starting as CLI...');
  startServer().catch(err => {
    console.error('[MoireServer] Fatal error:', err);
    process.exit(1);
  });
}