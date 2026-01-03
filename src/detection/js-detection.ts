/**
 * JS Detection Pipeline - Cross-Platform UI Element Detection
 * 
 * Features:
 * - Sobel Edge Detection
 * - Connected Component Labeling
 * - Non-Maximum Suppression
 * - Cross-platform (Win/Mac/Linux) via Jimp
 */

import * as fs from 'fs';
import * as path from 'path';

// Jimp type definitions
interface JimpRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface JimpImage {
  getWidth(): number;
  getHeight(): number;
  getPixelColor(x: number, y: number): number;
  clone(): JimpImage;
  greyscale(): JimpImage;
  crop(x: number, y: number, w: number, h: number): JimpImage;
  resize(w: number, h: number): JimpImage;
  scaleToFit(w: number, h: number): JimpImage;
  contrast(val: number): JimpImage;
  getBufferAsync(mime: string): Promise<Buffer>;
}

interface JimpStatic {
  read(source: string | Buffer): Promise<JimpImage>;
  intToRGBA(color: number): JimpRGBA;
  MIME_PNG: string;
}

// Jimp import 
let Jimp: JimpStatic | null = null;
try {
  Jimp = require('jimp');
} catch {
  Jimp = null;
}

export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  area?: number;
}

export interface DetectionResult {
  boxes: DetectionBox[];
  imageWidth: number;
  imageHeight: number;
  timestamp: number;
}

export interface DetectionConfig {
  outputDir: string;
  sobelThreshold: number;
  minBoxArea: number;
  maxBoxArea: number;
  nmsThreshold: number;
  padding: number;
}

const DEFAULT_CONFIG: DetectionConfig = {
  outputDir: './detection_results',
  sobelThreshold: 30,
  minBoxArea: 100,
  maxBoxArea: 500000,
  nmsThreshold: 0.3,
  padding: 2
};

export class JSDetectionPipeline {
  private config: DetectionConfig;

  constructor(config: Partial<DetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Ensure output directory exists
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  /**
   * Process an image and detect UI elements
   */
  async processImage(source: string | Buffer): Promise<DetectionResult> {
    if (!Jimp) {
      throw new Error('Jimp not available');
    }

    const image = await this.loadImage(source);
    if (!image) {
      throw new Error('Failed to load image');
    }

    const width = image.getWidth();
    const height = image.getHeight();

    // Step 1: Convert to grayscale and apply Sobel
    const edges = await this.sobelEdgeDetection(image);

    // Step 2: Find connected components
    const components = this.findConnectedComponents(edges, width, height);

    // Step 3: Extract bounding boxes
    let boxes = this.extractBoundingBoxes(components, width, height);

    // Step 4: Apply NMS
    boxes = this.nonMaxSuppression(boxes);

    // Step 5: Save results
    await this.saveResults(boxes, width, height);

    return {
      boxes,
      imageWidth: width,
      imageHeight: height,
      timestamp: Date.now()
    };
  }

  /**
   * Alias for processImage for compatibility
   */
  async detect(source: string | Buffer): Promise<DetectionResult> {
    return this.processImage(source);
  }

  private async loadImage(source: string | Buffer): Promise<JimpImage | null> {
    try {
      if (typeof source === 'string') {
        if (source.startsWith('data:')) {
          const base64 = source.split(',')[1];
          return await Jimp!.read(Buffer.from(base64, 'base64'));
        }
        return await Jimp!.read(source);
      }
      return await Jimp!.read(source);
    } catch (error) {
      console.error('[JSDetection] Failed to load image:', error);
      return null;
    }
  }

  private async sobelEdgeDetection(image: JimpImage): Promise<Uint8Array> {
    const width = image.getWidth();
    const height = image.getHeight();
    const edges = new Uint8Array(width * height);

    // Clone and convert to grayscale
    const gray = image.clone().greyscale();

    // Sobel kernels
    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pixel = Jimp!.intToRGBA(gray.getPixelColor(x + kx, y + ky));
            const intensity = pixel.r; // Already grayscale

            gx += intensity * sobelX[ky + 1][kx + 1];
            gy += intensity * sobelY[ky + 1][kx + 1];
          }
        }

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[y * width + x] = magnitude > this.config.sobelThreshold ? 255 : 0;
      }
    }

    return edges;
  }

  private findConnectedComponents(edges: Uint8Array, width: number, height: number): Map<number, number[]> {
    const labels = new Int32Array(width * height);
    const components = new Map<number, number[]>();
    let currentLabel = 0;
    const parent = new Map<number, number>();

    const find = (x: number): number => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) {
        parent.set(x, find(parent.get(x)!));
      }
      return parent.get(x)!;
    };

    const union = (a: number, b: number): void => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) {
        parent.set(rootB, rootA);
      }
    };

    // First pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (edges[idx] === 0) continue;

        const neighbors: number[] = [];
        if (x > 0 && labels[idx - 1] > 0) neighbors.push(labels[idx - 1]);
        if (y > 0 && labels[idx - width] > 0) neighbors.push(labels[idx - width]);

        if (neighbors.length === 0) {
          currentLabel++;
          labels[idx] = currentLabel;
          parent.set(currentLabel, currentLabel);
        } else {
          const minLabel = Math.min(...neighbors);
          labels[idx] = minLabel;
          for (const n of neighbors) {
            if (n !== minLabel) union(minLabel, n);
          }
        }
      }
    }

    // Second pass - resolve labels
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] > 0) {
        const root = find(labels[i]);
        if (!components.has(root)) {
          components.set(root, []);
        }
        components.get(root)!.push(i);
      }
    }

    return components;
  }

  private extractBoundingBoxes(components: Map<number, number[]>, width: number, height: number): DetectionBox[] {
    const boxes: DetectionBox[] = [];

    for (const [, pixels] of components) {
      if (pixels.length < this.config.minBoxArea / 4) continue;

      let minX = width, minY = height, maxX = 0, maxY = 0;

      for (const idx of pixels) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }

      const boxWidth = maxX - minX + this.config.padding * 2;
      const boxHeight = maxY - minY + this.config.padding * 2;
      const area = boxWidth * boxHeight;

      if (area < this.config.minBoxArea || area > this.config.maxBoxArea) continue;

      // Confidence based on edge density
      const density = pixels.length / area;
      const confidence = Math.min(1, density * 2);

      boxes.push({
        x: Math.max(0, minX - this.config.padding),
        y: Math.max(0, minY - this.config.padding),
        width: boxWidth,
        height: boxHeight,
        confidence,
        area
      });
    }

    return boxes;
  }

  private nonMaxSuppression(boxes: DetectionBox[]): DetectionBox[] {
    if (boxes.length === 0) return [];

    // Sort by confidence
    boxes.sort((a, b) => b.confidence - a.confidence);

    const keep: DetectionBox[] = [];

    while (boxes.length > 0) {
      const best = boxes.shift()!;
      keep.push(best);

      boxes = boxes.filter(box => {
        const iou = this.calculateIoU(best, box);
        return iou < this.config.nmsThreshold;
      });
    }

    return keep;
  }

  private calculateIoU(a: DetectionBox, b: DetectionBox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    if (x2 <= x1 || y2 <= y1) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - intersection;

    return intersection / union;
  }

  private async saveResults(boxes: DetectionBox[], width: number, height: number): Promise<void> {
    // Save as JSON
    const jsonPath = path.join(this.config.outputDir, 'component_boxes.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      boxes,
      imageWidth: width,
      imageHeight: height,
      timestamp: Date.now(),
      count: boxes.length
    }, null, 2));

    // Save as CSV
    const csvPath = path.join(this.config.outputDir, 'gradients', 'component_boxes.csv');
    const csvDir = path.dirname(csvPath);
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true });
    }

    const csvLines = ['x,y,width,height,confidence'];
    for (const box of boxes) {
      csvLines.push(`${box.x},${box.y},${box.width},${box.height},${box.confidence.toFixed(4)}`);
    }
    fs.writeFileSync(csvPath, csvLines.join('\n'));

    console.log(`[JSDetection] Saved ${boxes.length} boxes to ${this.config.outputDir}`);
  }

  getConfig(): DetectionConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<DetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default JSDetectionPipeline;