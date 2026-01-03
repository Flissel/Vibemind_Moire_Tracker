/**
 * OCR Service - Cross-Platform Text Recognition mit tesseract.js
 * 
 * Features:
 * - Erkennt Text in Detection-Boxes
 * - Streaming/inkrementelle Updates
 * - Mehrsprachig (DE, EN)
 * - Läuft auf Windows, macOS, Linux
 */

import { EventEmitter } from 'events';

// Tesseract type definitions
interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractRecognizeResult {
  data: {
    text: string;
    confidence: number;
    words?: TesseractWord[];
  };
}

interface TesseractWorker {
  terminate(): Promise<void>;
}

interface TesseractScheduler {
  addWorker(worker: TesseractWorker): void;
  addJob(type: 'recognize', image: Buffer | string): Promise<TesseractRecognizeResult>;
  terminate(): Promise<void>;
}

interface TesseractLoggerMessage {
  status: string;
  progress: number;
}

interface TesseractWorkerOptions {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
  logger?: (m: TesseractLoggerMessage) => void;
}

interface TesseractStatic {
  createScheduler(): TesseractScheduler;
  createWorker(lang: string, oem: number, options?: TesseractWorkerOptions): Promise<TesseractWorker>;
}

// Jimp type definitions
interface JimpImage {
  getWidth(): number;
  getHeight(): number;
  clone(): JimpImage;
  crop(x: number, y: number, w: number, h: number): JimpImage;
  greyscale(): JimpImage;
  contrast(val: number): JimpImage;
  getBufferAsync(mime: string): Promise<Buffer>;
}

interface JimpStatic {
  read(source: string | Buffer): Promise<JimpImage>;
  MIME_PNG: string;
}

// Tesseract.js import
let Tesseract: TesseractStatic | null = null;
try {
  Tesseract = require('tesseract.js');
} catch {
  Tesseract = null;
}

// Jimp for image cropping
let Jimp: JimpStatic | null = null;
try {
  Jimp = require('jimp');
} catch {
  Jimp = null;
}

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

export interface OCRResult {
  boxId: string;
  text: string;
  confidence: number;
  words?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export interface OCRConfig {
  languages: string[];
  minConfidence: number;
  maxConcurrent: number;
  workerPath?: string;
  corePath?: string;
  langPath?: string;
}

const DEFAULT_CONFIG: OCRConfig = {
  languages: ['eng', 'deu'],
  minConfidence: 0.4,
  maxConcurrent: 4
};

export class OCRService extends EventEmitter {
  private config: OCRConfig;
  private scheduler: TesseractScheduler | null = null;
  private workers: TesseractWorker[] = [];
  private isInitialized: boolean = false;
  private isProcessing: boolean = false;
  private processedCount: number = 0;
  private totalCount: number = 0;

  constructor(config: Partial<OCRConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (!Tesseract) {
      console.error('[OCR] tesseract.js not available');
      return false;
    }

    try {
      console.log('[OCR] Initializing with languages:', this.config.languages);
      
      // Create scheduler for parallel processing
      this.scheduler = Tesseract.createScheduler();

      // Create workers - tesseract.js v5 API
      // Only pass options that are actually defined (avoid passing undefined)
      for (let i = 0; i < this.config.maxConcurrent; i++) {
        const workerIndex = i;
        
        // Build options object only with defined values
        const workerOptions: Record<string, unknown> = {
          logger: (m: TesseractLoggerMessage) => {
            if (m.status === 'recognizing text') {
              this.emit('worker_progress', { workerId: workerIndex, progress: m.progress });
            }
          }
        };
        
        // Only add path options if explicitly set
        if (this.config.workerPath !== undefined) {
          workerOptions.workerPath = this.config.workerPath;
        }
        if (this.config.corePath !== undefined) {
          workerOptions.corePath = this.config.corePath;
        }
        if (this.config.langPath !== undefined) {
          workerOptions.langPath = this.config.langPath;
        }
        
        // tesseract.js v5: createWorker(langs, oem?, options?)
        const worker = await Tesseract.createWorker(
          this.config.languages.join('+'), 
          1,
          workerOptions as TesseractWorkerOptions
        );
        
        this.scheduler.addWorker(worker);
        this.workers.push(worker);
      }

      this.isInitialized = true;
      console.log(`[OCR] Initialized with ${this.workers.length} workers`);
      this.emit('initialized');
      return true;
    } catch (error) {
      console.error('[OCR] Initialization failed:', error);
      return false;
    }
  }

  async terminate(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.terminate();
      this.scheduler = null;
      this.workers = [];
      this.isInitialized = false;
      console.log('[OCR] Terminated');
    }
  }

  /**
   * Run OCR on all detection boxes
   * Emits 'ocr_update' events as each box is processed
   */
  async processBoxes(
    boxes: DetectionBox[],
    screenshotPath: string | Buffer
  ): Promise<OCRResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.scheduler || boxes.length === 0) {
      return [];
    }

    this.isProcessing = true;
    this.processedCount = 0;
    this.totalCount = boxes.length;

    const results: OCRResult[] = [];
    const screenshot = await this.loadImage(screenshotPath);
    if (!screenshot) {
      this.isProcessing = false;
      return [];
    }

    console.log(`[OCR] Processing ${boxes.length} boxes...`);
    this.emit('ocr_start', { total: boxes.length });

    // Process boxes in batches
    const batchSize = this.config.maxConcurrent;
    for (let i = 0; i < boxes.length; i += batchSize) {
      const batch = boxes.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(box => this.processBox(box, screenshot))
      );

      for (const result of batchResults) {
        if (result) {
          results.push(result);
          this.processedCount++;
          
          // Emit incremental update
          this.emit('ocr_update', {
            result,
            progress: (this.processedCount / this.totalCount) * 100,
            processedCount: this.processedCount,
            totalCount: this.totalCount
          });
        }
      }
    }

    this.isProcessing = false;
    console.log(`[OCR] Completed: ${results.length} texts found`);
    this.emit('ocr_complete', { results, total: results.length });

    return results;
  }

  private async processBox(
    box: DetectionBox,
    screenshot: JimpImage
  ): Promise<OCRResult | null> {
    try {
      // Crop the box region from screenshot
      const cropped = await this.cropRegion(screenshot, box);
      if (!cropped) return null;

      // Run OCR on cropped region
      const { data } = await this.scheduler!.addJob('recognize', cropped);

      const text = data.text?.trim() || '';
      const confidence = data.confidence / 100;

      if (text.length === 0 || confidence < this.config.minConfidence) {
        return null;
      }

      const result: OCRResult = {
        boxId: box.id,
        text,
        confidence,
        words: data.words?.map((w: TesseractWord) => ({
          text: w.text,
          confidence: w.confidence / 100,
          bbox: w.bbox
        }))
      };

      return result;
    } catch (error) {
      console.error(`[OCR] Error processing box ${box.id}:`, error);
      return null;
    }
  }

  private async loadImage(source: string | Buffer): Promise<JimpImage | null> {
    if (!Jimp) {
      console.error('[OCR] Jimp not available for image processing');
      return null;
    }

    try {
      if (typeof source === 'string') {
        // Check if it's a data URL
        if (source.startsWith('data:')) {
          const base64 = source.split(',')[1];
          return await Jimp.read(Buffer.from(base64, 'base64'));
        }
        // File path
        return await Jimp.read(source);
      }
      // Buffer
      return await Jimp.read(source);
    } catch (error) {
      console.error('[OCR] Failed to load image:', error);
      return null;
    }
  }

  private async cropRegion(image: JimpImage, box: DetectionBox): Promise<Buffer | null> {
    try {
      // Add padding
      const padding = 2;
      const x = Math.max(0, box.x - padding);
      const y = Math.max(0, box.y - padding);
      const w = Math.min(image.getWidth() - x, box.width + padding * 2);
      const h = Math.min(image.getHeight() - y, box.height + padding * 2);

      const cropped = image.clone().crop(x, y, w, h);

      // Preprocessing for better OCR
      cropped.greyscale().contrast(0.3);

      return await cropped.getBufferAsync(Jimp!.MIME_PNG);
    } catch (error) {
      console.error('[OCR] Crop failed:', error);
      return null;
    }
  }

  /**
   * Quick single-image OCR (no boxes)
   */
  async recognizeImage(source: string | Buffer): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.scheduler) return '';

    try {
      const image = await this.loadImage(source);
      if (!image) return '';

      const buffer = await image.getBufferAsync(Jimp!.MIME_PNG);
      const { data } = await this.scheduler.addJob('recognize', buffer);

      return data.text?.trim() || '';
    } catch (error) {
      console.error('[OCR] Recognition failed:', error);
      return '';
    }
  }

  /**
   * OCR on specific region
   */
  async recognizeRegion(
    source: string | Buffer,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<string> {
    const image = await this.loadImage(source);
    if (!image) return '';

    try {
      const cropped = image.clone().crop(x, y, width, height);
      const buffer = await cropped.getBufferAsync(Jimp!.MIME_PNG);

      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!this.scheduler) return '';

      const { data } = await this.scheduler.addJob('recognize', buffer);
      return data.text?.trim() || '';
    } catch (error) {
      console.error('[OCR] Region recognition failed:', error);
      return '';
    }
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  getProgress(): { processed: number; total: number; percent: number } {
    return {
      processed: this.processedCount,
      total: this.totalCount,
      percent: this.totalCount > 0 ? (this.processedCount / this.totalCount) * 100 : 0
    };
  }

  isRunning(): boolean {
    return this.isProcessing;
  }
}

// Singleton
let ocrServiceInstance: OCRService | null = null;

export function getOCRService(config?: Partial<OCRConfig>): OCRService {
  if (!ocrServiceInstance) {
    ocrServiceInstance = new OCRService(config);
  }
  return ocrServiceInstance;
}

export function resetOCRService(): void {
  if (ocrServiceInstance) {
    ocrServiceInstance.terminate();
    ocrServiceInstance = null;
  }
}

export default OCRService;