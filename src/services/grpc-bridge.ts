/**
 * gRPC Bridge Service für MoireTracker
 * 
 * Verbindet den TypeScript MoireServer mit dem Python gRPC Worker Host.
 * Kommunikation läuft über HTTP/REST da direktes gRPC in Browser nicht möglich.
 * 
 * Features:
 * - Batch Classification Request
 * - Worker Status Abfrage
 * - Active Learning Callbacks
 */

import { EventEmitter } from 'events';

// ==================== Interfaces ====================

export interface ClassifyIconRequest {
  boxId: string;
  cropBase64: string;
  cnnCategory?: string;
  cnnConfidence: number;
  ocrText?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface ClassificationResult {
  boxId: string;
  llmCategory: string;
  llmConfidence: number;
  reasoning?: string;
  processingTimeMs: number;
  error?: string;
}

export interface ValidationResult {
  boxId: string;
  finalCategory: string;
  finalConfidence: number;
  cnnCategory?: string;
  llmCategory: string;
  categoriesMatch: boolean;
  needsHumanReview: boolean;
  addToTraining: boolean;
  trainingLabel?: string;
  validationReasoning: string;
}

export interface BatchClassifyRequest {
  batchId: string;
  icons: ClassifyIconRequest[];
  priority?: number;
  timeoutSeconds?: number;
}

export interface BatchClassifyResult {
  batchId: string;
  results: ValidationResult[];
  totalIcons: number;
  successful: number;
  failed: number;
  processingTimeMs: number;
  workersUsed: number;
}

export interface WorkerStats {
  totalWorkers: number;
  byType: {
    classification: number;
    validation: number;
    execution: number;
  };
  totalProcessed: number;
  totalFailed: number;
}

export interface HostStatus {
  address: string;
  isRunning: boolean;
  maxWorkers: number;
  pendingBatches: number;
  workers: WorkerStats;
}

export interface GrpcBridgeConfig {
  pythonHostUrl: string;
  timeout: number;
  maxRetries: number;
  enableFallback: boolean;
}

// ==================== Default Config ====================

const DEFAULT_CONFIG: GrpcBridgeConfig = {
  pythonHostUrl: 'http://localhost:8766',  // Python HTTP Bridge Port
  timeout: 30000,
  maxRetries: 3,
  enableFallback: true
};

// ==================== GrpcBridge Class ====================

export class GrpcBridge extends EventEmitter {
  private config: GrpcBridgeConfig;
  private isConnected: boolean = false;
  private lastStatus: HostStatus | null = null;

  constructor(config: Partial<GrpcBridgeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Prüft Verbindung zum Python Host
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/status`,
        { method: 'GET' },
        5000
      );
      
      if (response.ok) {
        this.lastStatus = await response.json();
        this.isConnected = this.lastStatus?.isRunning ?? false;
        return this.isConnected;
      }
      return false;
    } catch (error) {
      console.warn('[GrpcBridge] Connection check failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Klassifiziert einen Batch von Icons über den Python gRPC Host
   */
  async classifyBatch(icons: ClassifyIconRequest[]): Promise<BatchClassifyResult> {
    const batchId = `batch_${Date.now()}`;
    
    console.log(`[GrpcBridge] Starting batch classification: ${icons.length} icons`);
    this.emit('batch_start', { batchId, count: icons.length });

    try {
      // Convert to Python format
      const request: BatchClassifyRequest = {
        batchId,
        icons: icons.map(icon => ({
          boxId: icon.boxId,
          cropBase64: icon.cropBase64,
          cnnCategory: icon.cnnCategory,
          cnnConfidence: icon.cnnConfidence,
          ocrText: icon.ocrText,
          bounds: icon.bounds
        })),
        priority: 0,
        timeoutSeconds: Math.floor(this.config.timeout / 1000)
      };

      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/classify_batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        },
        this.config.timeout
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const result: BatchClassifyResult = await response.json();
      
      console.log(`[GrpcBridge] Batch complete: ${result.successful}/${result.totalIcons} successful`);
      this.emit('batch_complete', result);
      
      return result;

    } catch (error) {
      console.error('[GrpcBridge] Batch classification failed:', error);
      
      // Fallback: Return empty result with error
      const errorResult: BatchClassifyResult = {
        batchId,
        results: icons.map(icon => ({
          boxId: icon.boxId,
          finalCategory: icon.cnnCategory || 'unknown',
          finalConfidence: icon.cnnConfidence,
          llmCategory: 'error',
          categoriesMatch: false,
          needsHumanReview: true,
          addToTraining: false,
          validationReasoning: `Error: ${error}`
        })),
        totalIcons: icons.length,
        successful: 0,
        failed: icons.length,
        processingTimeMs: 0,
        workersUsed: 0
      };
      
      this.emit('batch_error', { batchId, error });
      return errorResult;
    }
  }

  /**
   * Klassifiziert ein einzelnes Icon
   */
  async classifySingle(icon: ClassifyIconRequest): Promise<ValidationResult> {
    const result = await this.classifyBatch([icon]);
    return result.results[0];
  }

  /**
   * Holt Worker Status vom Python Host
   */
  async getHostStatus(): Promise<HostStatus | null> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/status`,
        { method: 'GET' },
        5000
      );
      
      if (response.ok) {
        this.lastStatus = await response.json();
        return this.lastStatus;
      }
      return null;
    } catch (error) {
      console.warn('[GrpcBridge] Status check failed:', error);
      return null;
    }
  }

  /**
   * Startet den Python gRPC Host (falls nicht läuft)
   */
  async startHost(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/start`,
        { method: 'POST' },
        10000
      );
      return response.ok;
    } catch (error) {
      console.error('[GrpcBridge] Failed to start host:', error);
      return false;
    }
  }

  /**
   * Stoppt den Python gRPC Host
   */
  async stopHost(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/stop`,
        { method: 'POST' },
        5000
      );
      return response.ok;
    } catch (error) {
      console.error('[GrpcBridge] Failed to stop host:', error);
      return false;
    }
  }

  /**
   * Holt Active Learning Queue vom Host
   */
  async getActiveLearningQueue(): Promise<ValidationResult[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/active_learning/queue`,
        { method: 'GET' },
        5000
      );
      
      if (response.ok) {
        const data = await response.json();
        return data.queue || [];
      }
      return [];
    } catch (error) {
      console.warn('[GrpcBridge] Active learning queue fetch failed:', error);
      return [];
    }
  }

  /**
   * Bestätigt ein Active Learning Label
   */
  async confirmLabel(boxId: string, confirmedLabel: string): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.pythonHostUrl}/active_learning/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxId, confirmedLabel })
        },
        5000
      );
      return response.ok;
    } catch (error) {
      console.error('[GrpcBridge] Label confirmation failed:', error);
      return false;
    }
  }

  // ==================== Private Helpers ====================

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==================== Status ====================

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getLastStatus(): HostStatus | null {
    return this.lastStatus;
  }

  getConfig(): GrpcBridgeConfig {
    return { ...this.config };
  }
}

// ==================== Singleton ====================

let bridgeInstance: GrpcBridge | null = null;

export function getGrpcBridge(config?: Partial<GrpcBridgeConfig>): GrpcBridge {
  if (!bridgeInstance) {
    bridgeInstance = new GrpcBridge(config);
  }
  return bridgeInstance;
}

export function resetGrpcBridge(): void {
  bridgeInstance = null;
}

export default GrpcBridge;