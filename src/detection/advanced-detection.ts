/*
 * Advanced Detection Pipeline - Cross-Platform
 * 
 * Port der C++ Detection Pipeline aus detect_icons_temporal.cpp
 * 
 * Features:
 * - Difference of Gaussian (DoG) Filter (Biological Vision)
 * - Morphological Operations (Dilate/Erode)
 * - Percentile-based Gradient Preprocessing 
 * - Connected Component Analysis (Union-Find)
 * - Region Detection (Gap-based Segmentation)
 * - Line Grouping (Horizontal/Vertical)
 * - Advanced Confidence Scoring:
 *   - Background Uniformity Analysis
 *   - Gradient Isolation Score
 *   - Content Density Analysis
 * - Non-Maximum Suppression
 */

import * as fs from 'fs';
import * as path from 'path';

// Jimp import
let Jimp: any;
try {
  Jimp = require('jimp');
} catch {
  Jimp = null;
}

// ==================== Types ====================

export interface DetectionBox {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  area?: number;
  text?: string;
  category?: string;
}

export interface Region {
  id: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  boxIndices: number[];
  numLines: number;
}

export interface LineGroup {
  id: number;
  regionId: number;
  orientation: 'horizontal' | 'vertical';
  boxIndices: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  avgBoxWidth: number;
  avgBoxHeight: number;
  avgSpacing: number;
}

export interface DetectionResult {
  boxes: DetectionBox[];
  regions: Region[];
  lines: LineGroup[];
  imageWidth: number;
  imageHeight: number;
  timestamp: number;
  processingTimeMs: number;
}

export interface AdvancedDetectionConfig {
  outputDir: string;
  
  // DoG Filter
  dogSigma1: number;
  dogSigma2: number;
  dogWeight: number;
  
  // Morphological
  dilateKernelSize: number;
  dilateIterations: number;
  erodeKernelSize: number;
  erodeIterations: number;
  
  // Preprocessing
  gradientPercentile: number;
  
  // Connected Components
  minComponentPixels: number;
  componentThreshold: number;
  
  // Box Filtering
  minBoxArea: number;
  maxBoxArea: number;
  minBoxSize: number;
  maxBoxSize: number;
  
  // Region Detection
  xGapThreshold: number;
  yGapThreshold: number;
  
  // Line Grouping
  lineYTolerance: number;
  lineXTolerance: number;
  
  // Confidence Thresholds
  minConfidence: number;
  
  // NMS
  nmsThreshold: number;
  
  // Debug
  saveDebugImages: boolean;
}

const DEFAULT_CONFIG: AdvancedDetectionConfig = {
  outputDir: './detection_results',
  
  // DoG Filter (matches biological filters)
  dogSigma1: 1.0,
  dogSigma2: 2.5,
  dogWeight: 0.5,
  
  // Morphological (from C++ adaptive params)
  dilateKernelSize: 3,
  dilateIterations: 2,
  erodeKernelSize: 3,
  erodeIterations: 1,
  
  // Preprocessing (85th percentile from C++)
  gradientPercentile: 85,
  
  // Connected Components
  minComponentPixels: 25,
  componentThreshold: 0.01,
  
  // Box Filtering (from C++ icon size range)
  minBoxArea: 100,
  maxBoxArea: 500000,
  minBoxSize: 8,
  maxBoxSize: 500,
  
  // Region Detection (from C++ adaptive)
  xGapThreshold: 80,
  yGapThreshold: 40,
  
  // Line Grouping
  lineYTolerance: 10,
  lineXTolerance: 10,
  
  // Confidence (from C++ MIN_CONFIDENCE = 0.35)
  minConfidence: 0.35,
  
  // NMS
  nmsThreshold: 0.3,
  
  // Debug
  saveDebugImages: false
};

// ==================== Main Class ====================

export class AdvancedDetectionPipeline {
  private config: AdvancedDetectionConfig;

  constructor(config: Partial<AdvancedDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Ensure output directories
    const dirs = [
      this.config.outputDir,
      path.join(this.config.outputDir, 'gradients'),
      path.join(this.config.outputDir, 'regions'),
      path.join(this.config.outputDir, 'lines')
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Main detection pipeline
   */
  async processImage(source: string | Buffer): Promise<DetectionResult> {
    const startTime = Date.now();
    
    if (!Jimp) {
      throw new Error('Jimp not available');
    }

    const image = await this.loadImage(source);
    if (!image) {
      throw new Error('Failed to load image');
    }

    const width = image.getWidth();
    const height = image.getHeight();

    console.log(`[AdvancedDetection] Processing ${width}x${height} image...`);

    // Step 1: Convert to grayscale luminance
    const luminance = this.extractLuminance(image, width, height);

    // Step 2: Apply DoG (Difference of Gaussian) - Biological Filter
    const dogFiltered = this.applyDoG(luminance, width, height);
    
    // Step 3: Calculate Sobel gradients
    let gradients = this.sobelGradient(dogFiltered, width, height);

    // Step 4: Percentile-based preprocessing
    gradients = this.preprocessGradients(gradients, width, height);

    // Step 5: Morphological operations
    gradients = this.morphologicalDilate(gradients, width, height);
    gradients = this.morphologicalDilate(gradients, width, height);
    gradients = this.morphologicalErode(gradients, width, height);

    // Step 6: Find connected components
    let boxes = this.findConnectedComponents(gradients, width, height);
    console.log(`[AdvancedDetection] Found ${boxes.length} connected components`);

    // Step 7: Calculate advanced confidence scores
    boxes = this.calculateAdvancedConfidence(boxes, gradients, luminance, width, height);

    // Step 8: Filter by confidence
    boxes = boxes.filter(b => b.confidence >= this.config.minConfidence);
    console.log(`[AdvancedDetection] ${boxes.length} boxes pass confidence threshold`);

    // Step 9: Non-Maximum Suppression
    boxes = this.nonMaxSuppression(boxes);
    console.log(`[AdvancedDetection] ${boxes.length} boxes after NMS`);

    // Step 10: Assign IDs
    boxes = boxes.map((box, idx) => ({ ...box, id: idx }));

    // Step 11: Detect regions (gap-based segmentation)
    const regions = this.detectRegions(boxes);
    console.log(`[AdvancedDetection] Detected ${regions.length} regions`);

    // Step 12: Group into lines
    const boxToRegion = this.createBoxToRegionMap(regions, boxes.length);
    const lines = this.groupIntoLines(boxes, boxToRegion);
    console.log(`[AdvancedDetection] Grouped into ${lines.length} lines`);

    // Step 13: Save results
    await this.saveResults(boxes, regions, lines, width, height, image);

    const processingTimeMs = Date.now() - startTime;
    console.log(`[AdvancedDetection] Complete in ${processingTimeMs}ms: ${boxes.length} boxes, ${regions.length} regions, ${lines.length} lines`);

    return {
      boxes,
      regions,
      lines,
      imageWidth: width,
      imageHeight: height,
      timestamp: Date.now(),
      processingTimeMs
    };
  }

  /**
   * Alias for processImage
   */
  async detect(source: string | Buffer): Promise<DetectionResult> {
    return this.processImage(source);
  }

  // ==================== Image Loading ====================

  private async loadImage(source: string | Buffer): Promise<any> {
    try {
      if (typeof source === 'string') {
        if (source.startsWith('data:')) {
          const base64 = source.split(',')[1];
          return await Jimp.read(Buffer.from(base64, 'base64'));
        }
        return await Jimp.read(source);
      }
      return await Jimp.read(source);
    } catch (error) {
      console.error('[AdvancedDetection] Failed to load image:', error);
      return null;
    }
  }

  // ==================== Luminance Extraction ====================

  private extractLuminance(image: any, width: number, height: number): Float32Array {
    const luminance = new Float32Array(width * height);
    
    // Use direct pixel access instead of scan() to avoid 'this' binding issues
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = image.bitmap.data[idx + 0] / 255;
        const g = image.bitmap.data[idx + 1] / 255;
        const b = image.bitmap.data[idx + 2] / 255;
        // ITU-R BT.601 luminance formula
        luminance[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }

    return luminance;
  }

  // ==================== DoG Filter (Biological Vision) ====================

  private applyDoG(input: Float32Array, width: number, height: number): Float32Array {
    const { dogSigma1, dogSigma2, dogWeight } = this.config;
    
    // Create Gaussian kernels
    const kernel1 = this.createGaussianKernel(dogSigma1);
    const kernel2 = this.createGaussianKernel(dogSigma2);
    
    // Apply both Gaussian blurs
    const blur1 = this.convolve(input, width, height, kernel1);
    const blur2 = this.convolve(input, width, height, kernel2);
    
    // Difference of Gaussian
    const result = new Float32Array(width * height);
    for (let i = 0; i < result.length; i++) {
      result[i] = input[i] - dogWeight * (blur2[i] - blur1[i]);
    }
    
    return result;
  }

  private createGaussianKernel(sigma: number): { kernel: Float32Array, size: number } {
    const size = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = new Float32Array(size * size);
    const center = Math.floor(size / 2);
    let sum = 0;
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        kernel[y * size + x] = value;
        sum += value;
      }
    }
    
    // Normalize
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= sum;
    }
    
    return { kernel, size };
  }

  private convolve(input: Float32Array, width: number, height: number, 
                   kernelData: { kernel: Float32Array, size: number }): Float32Array {
    const { kernel, size } = kernelData;
    const halfSize = Math.floor(size / 2);
    const result = new Float32Array(width * height);
    
    for (let y = halfSize; y < height - halfSize; y++) {
      for (let x = halfSize; x < width - halfSize; x++) {
        let sum = 0;
        for (let ky = 0; ky < size; ky++) {
          for (let kx = 0; kx < size; kx++) {
            const ix = x + kx - halfSize;
            const iy = y + ky - halfSize;
            sum += input[iy * width + ix] * kernel[ky * size + kx];
          }
        }
        result[y * width + x] = sum;
      }
    }
    
    return result;
  }

  // ==================== Sobel Gradient ====================

  private sobelGradient(input: Float32Array, width: number, height: number): Float32Array {
    const gradients = new Float32Array(width * height);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const tl = input[(y - 1) * width + (x - 1)];
        const tc = input[(y - 1) * width + x];
        const tr = input[(y - 1) * width + (x + 1)];
        const ml = input[y * width + (x - 1)];
        const mr = input[y * width + (x + 1)];
        const bl = input[(y + 1) * width + (x - 1)];
        const bc = input[(y + 1) * width + x];
        const br = input[(y + 1) * width + (x + 1)];
        
        const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        
        gradients[y * width + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    
    return gradients;
  }

  // ==================== Percentile Preprocessing ====================

  private preprocessGradients(gradients: Float32Array, _width: number, _height: number): Float32Array {
    const { gradientPercentile } = this.config;
    
    // Collect non-zero gradients
    const nonZero: number[] = [];
    const MIN_GRADIENT = 0.001;
    
    for (const val of gradients) {
      if (val > MIN_GRADIENT) {
        nonZero.push(val);
      }
    }
    
    if (nonZero.length === 0) return gradients;
    
    // Sort and find percentile threshold
    nonZero.sort((a, b) => a - b);
    const idx = Math.floor((nonZero.length * gradientPercentile) / 100);
    const threshold = nonZero[Math.min(idx, nonZero.length - 1)];
    
    console.log(`[AdvancedDetection] Gradient preprocessing: ${gradientPercentile}th percentile threshold = ${threshold.toFixed(4)}`);
    
    // Apply threshold
    const result = new Float32Array(gradients.length);
    let kept = 0;
    for (let i = 0; i < gradients.length; i++) {
      if (gradients[i] >= threshold) {
        result[i] = gradients[i];
        kept++;
      }
    }
    
    const keepPercent = (kept * 100 / nonZero.length).toFixed(1);
    console.log(`[AdvancedDetection] Kept ${kept} gradient pixels (${keepPercent}%)`);
    
    return result;
  }

  // ==================== Morphological Operations ====================

  private morphologicalDilate(input: Float32Array, width: number, height: number): Float32Array {
    const { dilateKernelSize } = this.config;
    const halfKernel = Math.floor(dilateKernelSize / 2);
    const result = new Float32Array(input.length);
    
    for (let y = halfKernel; y < height - halfKernel; y++) {
      for (let x = halfKernel; x < width - halfKernel; x++) {
        let maxVal = 0;
        for (let dy = -halfKernel; dy <= halfKernel; dy++) {
          for (let dx = -halfKernel; dx <= halfKernel; dx++) {
            const idx = (y + dy) * width + (x + dx);
            maxVal = Math.max(maxVal, input[idx]);
          }
        }
        result[y * width + x] = maxVal;
      }
    }
    
    return result;
  }

  private morphologicalErode(input: Float32Array, width: number, height: number): Float32Array {
    const { erodeKernelSize } = this.config;
    const halfKernel = Math.floor(erodeKernelSize / 2);
    const result = new Float32Array(input.length);
    result.fill(255);
    
    for (let y = halfKernel; y < height - halfKernel; y++) {
      for (let x = halfKernel; x < width - halfKernel; x++) {
        let minVal = 255;
        for (let dy = -halfKernel; dy <= halfKernel; dy++) {
          for (let dx = -halfKernel; dx <= halfKernel; dx++) {
            const idx = (y + dy) * width + (x + dx);
            minVal = Math.min(minVal, input[idx]);
          }
        }
        result[y * width + x] = minVal;
      }
    }
    
    return result;
  }

  // ==================== Connected Components (Union-Find) ====================

  private findConnectedComponents(gradients: Float32Array, width: number, height: number): DetectionBox[] {
    const { minComponentPixels, componentThreshold } = this.config;
    const visited = new Uint8Array(width * height);
    const boxes: DetectionBox[] = [];
    
    // Flood fill to find connected regions
    for (let startY = 0; startY < height; startY++) {
      for (let startX = 0; startX < width; startX++) {
        const startIdx = startY * width + startX;
        
        if (visited[startIdx] || gradients[startIdx] <= componentThreshold) {
          continue;
        }
        
        // Found unvisited gradient pixel - start flood fill
        const regionPixels: Array<[number, number]> = [];
        const queue: Array<[number, number]> = [[startX, startY]];
        visited[startIdx] = 1;
        
        let minX = startX, maxX = startX;
        let minY = startY, maxY = startY;
        
        while (queue.length > 0 && regionPixels.length < 100000) {
          const [x, y] = queue.shift()!;
          regionPixels.push([x, y]);
          
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          
          // 4-connected neighbors
          const neighbors = [
            [x - 1, y], [x + 1, y],
            [x, y - 1], [x, y + 1]
          ];
          
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (!visited[nIdx] && gradients[nIdx] > componentThreshold) {
                visited[nIdx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }
        
        // Filter by size
        if (regionPixels.length >= minComponentPixels) {
          const boxWidth = maxX - minX + 1;
          const boxHeight = maxY - minY + 1;
          const area = boxWidth * boxHeight;
          
          if (area >= this.config.minBoxArea && area <= this.config.maxBoxArea &&
              boxWidth >= this.config.minBoxSize && boxHeight >= this.config.minBoxSize &&
              boxWidth <= this.config.maxBoxSize && boxHeight <= this.config.maxBoxSize) {
            
            const density = regionPixels.length / area;
            
            boxes.push({
              id: boxes.length,
              x: minX,
              y: minY,
              width: boxWidth,
              height: boxHeight,
              confidence: density, // Initial confidence based on density
              area
            });
          }
        }
      }
    }
    
    return boxes;
  }

  // ==================== Advanced Confidence Scoring ====================

  private calculateAdvancedConfidence(
    boxes: DetectionBox[],
    gradients: Float32Array,
    luminance: Float32Array,
    width: number,
    height: number
  ): DetectionBox[] {
    
    return boxes.map(box => {
      // 1. Background Uniformity (most important)
      const bgUniformity = this.analyzeBackgroundUniformity(luminance, box, width, height);
      
      // 2. Gradient Isolation
      const gradientIsolation = this.calculateGradientIsolation(gradients, box, width, height);
      
      // 3. Content Density
      const contentDensity = this.analyzeContentDensity(gradients, box, width, height);
      
      // 4. Edge Density (original metric)
      const edgeDensity = this.calculateEdgeDensity(gradients, box, width, height);
      
      // Combined confidence score (from C++ weights)
      const confidence = 
        0.40 * bgUniformity +       // MOST IMPORTANT! (background analysis)
        0.30 * gradientIsolation +  // Second most important (isolation)
        0.15 * contentDensity +     // Content structure
        0.10 * edgeDensity +        // Original geometric metric
        0.05 * (box.confidence || 0.5); // Density from connected components
      
      return { ...box, confidence };
    });
  }

  private analyzeBackgroundUniformity(
    luminance: Float32Array,
    box: DetectionBox,
    width: number,
    height: number
  ): number {
    const BORDER_SIZE = 8;
    const samples: number[] = [];
    
    // Sample top border
    for (let x = Math.max(0, box.x - BORDER_SIZE); x < Math.min(width, box.x + box.width + BORDER_SIZE); x++) {
      const y = Math.max(0, box.y - BORDER_SIZE / 2);
      if (y >= 0 && y < height) {
        samples.push(luminance[y * width + x]);
      }
    }
    
    // Sample bottom border
    for (let x = Math.max(0, box.x - BORDER_SIZE); x < Math.min(width, box.x + box.width + BORDER_SIZE); x++) {
      const y = Math.min(height - 1, box.y + box.height + BORDER_SIZE / 2);
      if (y >= 0 && y < height) {
        samples.push(luminance[y * width + x]);
      }
    }
    
    // Sample left border
    for (let y = Math.max(0, box.y - BORDER_SIZE); y < Math.min(height, box.y + box.height + BORDER_SIZE); y++) {
      const x = Math.max(0, box.x - BORDER_SIZE / 2);
      if (x >= 0 && x < width) {
        samples.push(luminance[y * width + x]);
      }
    }
    
    // Sample right border
    for (let y = Math.max(0, box.y - BORDER_SIZE); y < Math.min(height, box.y + box.height + BORDER_SIZE); y++) {
      const x = Math.min(width - 1, box.x + box.width + BORDER_SIZE / 2);
      if (x >= 0 && x < width) {
        samples.push(luminance[y * width + x]);
      }
    }
    
    if (samples.length === 0) return 0.5;
    
    // Calculate mean and std deviation
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, val) => sum + (val - mean) ** 2, 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    
    // Convert to score (from C++)
    if (stdDev < 0.03) return 1.0;  // Very uniform = icon on wallpaper
    if (stdDev > 0.12) return 0.0;  // Very varied = wallpaper curve or window
    
    return (0.12 - stdDev) / 0.09;
  }

  private calculateGradientIsolation(
    gradients: Float32Array,
    box: DetectionBox,
    width: number,
    height: number
  ): number {
    const MARGIN = 20;
    
    // Inner energy (inside box)
    let innerEnergy = 0;
    let innerCount = 0;
    for (let y = box.y; y < box.y + box.height && y < height; y++) {
      for (let x = box.x; x < box.x + box.width && x < width; x++) {
        const grad = gradients[y * width + x];
        innerEnergy += grad * grad;
        innerCount++;
      }
    }
    if (innerCount > 0) innerEnergy /= innerCount;
    
    // Outer energy (margin around box)
    let outerEnergy = 0;
    let outerCount = 0;
    
    // Top margin
    for (let y = Math.max(0, box.y - MARGIN); y < box.y && y < height; y++) {
      for (let x = Math.max(0, box.x - MARGIN); x < Math.min(width, box.x + box.width + MARGIN); x++) {
        const grad = gradients[y * width + x];
        outerEnergy += grad * grad;
        outerCount++;
      }
    }
    
    // Bottom margin
    for (let y = box.y + box.height; y < Math.min(height, box.y + box.height + MARGIN); y++) {
      for (let x = Math.max(0, box.x - MARGIN); x < Math.min(width, box.x + box.width + MARGIN); x++) {
        const grad = gradients[y * width + x];
        outerEnergy += grad * grad;
        outerCount++;
      }
    }
    
    // Left margin
    for (let y = box.y; y < box.y + box.height && y < height; y++) {
      for (let x = Math.max(0, box.x - MARGIN); x < box.x; x++) {
        const grad = gradients[y * width + x];
        outerEnergy += grad * grad;
        outerCount++;
      }
    }
    
    // Right margin
    for (let y = box.y; y < box.y + box.height && y < height; y++) {
      for (let x = box.x + box.width; x < Math.min(width, box.x + box.width + MARGIN); x++) {
        const grad = gradients[y * width + x];
        outerEnergy += grad * grad;
        outerCount++;
      }
    }
    
    if (outerCount > 0) outerEnergy /= outerCount;
    
    // Isolation ratio
    const isolationRatio = (innerEnergy + 0.01) / (outerEnergy + 0.01);
    
    if (isolationRatio > 4.0) return 1.0;  // Highly isolated = icon
    if (isolationRatio < 1.2) return 0.0;  // Not isolated = wallpaper
    
    return (isolationRatio - 1.2) / 2.8;
  }

  private analyzeContentDensity(
    gradients: Float32Array,
    box: DetectionBox,
    width: number,
    height: number
  ): number {
    if (box.width < 16 || box.height < 16) return 0.5;
    
    const halfW = Math.floor(box.width / 2);
    const halfH = Math.floor(box.height / 2);
    const threshold = this.config.componentThreshold;
    
    const quadrantDensities: number[] = [];
    
    // Analyze 4 quadrants
    for (let qy = 0; qy < 2; qy++) {
      for (let qx = 0; qx < 2; qx++) {
        const startX = box.x + qx * halfW;
        const startY = box.y + qy * halfH;
        const endX = startX + halfW;
        const endY = startY + halfH;
        
        let edgeCount = 0;
        let totalCount = 0;
        
        for (let y = startY; y < endY && y < height; y++) {
          for (let x = startX; x < endX && x < width; x++) {
            if (gradients[y * width + x] > threshold) {
              edgeCount++;
            }
            totalCount++;
          }
        }
        
        quadrantDensities.push(totalCount > 0 ? edgeCount / totalCount : 0);
      }
    }
    
    // Calculate variance
    const meanDensity = quadrantDensities.reduce((a, b) => a + b, 0) / quadrantDensities.length;
    const variance = quadrantDensities.reduce((sum, d) => sum + (d - meanDensity) ** 2, 0) / quadrantDensities.length;
    
    // Check if density is in reasonable range
    const densityOk = meanDensity > 0.02 && meanDensity < 0.4;
    
    if (!densityOk) return 0.0;
    if (variance < 0.001) return 0.3;  // Too uniform
    if (variance > 0.05) return 0.2;   // Too chaotic
    
    const idealVariance = 0.015;
    const dist = Math.abs(variance - idealVariance);
    return Math.max(0.0, 1.0 - (dist / 0.035));
  }

  private calculateEdgeDensity(
    gradients: Float32Array,
    box: DetectionBox,
    width: number,
    height: number
  ): number {
    let edgePixels = 0;
    const threshold = this.config.componentThreshold;
    
    for (let y = box.y; y < box.y + box.height && y < height; y++) {
      for (let x = box.x; x < box.x + box.width && x < width; x++) {
        if (gradients[y * width + x] > threshold) {
          edgePixels++;
        }
      }
    }
    
    const area = box.width * box.height;
    return area > 0 ? edgePixels / area : 0;
  }

  // ==================== Non-Maximum Suppression ====================

  private nonMaxSuppression(boxes: DetectionBox[]): DetectionBox[] {
    if (boxes.length === 0) return [];
    
    // Sort by confidence (descending)
    const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
    const keep: DetectionBox[] = [];
    
    while (sorted.length > 0) {
      const best = sorted.shift()!;
      keep.push(best);
      
      // Remove overlapping boxes
      for (let i = sorted.length - 1; i >= 0; i--) {
        const iou = this.calculateIoU(best, sorted[i]);
        if (iou > this.config.nmsThreshold) {
          sorted.splice(i, 1);
        }
      }
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

  // ==================== Region Detection ====================

  private detectRegions(boxes: DetectionBox[]): Region[] {
    if (boxes.length === 0) return [];
    
    const { xGapThreshold, yGapThreshold } = this.config;
    const regions: Region[] = [];
    
    // Sort by X position
    const sortedIndices = boxes.map((_, i) => i)
      .sort((a, b) => boxes[a].x - boxes[b].x);
    
    // Find vertical splits (large X gaps)
    const verticalSlices: number[][] = [];
    let currentSlice: number[] = [];
    
    for (let i = 0; i < sortedIndices.length; i++) {
      const idx = sortedIndices[i];
      
      if (currentSlice.length === 0) {
        currentSlice.push(idx);
      } else {
        const prevIdx = sortedIndices[i - 1];
        const prevRight = boxes[prevIdx].x + boxes[prevIdx].width;
        const currLeft = boxes[idx].x;
        const gap = currLeft - prevRight;
        
        if (gap > xGapThreshold) {
          verticalSlices.push(currentSlice);
          currentSlice = [];
        }
        currentSlice.push(idx);
      }
    }
    if (currentSlice.length > 0) {
      verticalSlices.push(currentSlice);
    }
    
    // For each vertical slice, find horizontal splits
    let regionId = 0;
    
    for (const vSlice of verticalSlices) {
      // Sort by Y
      vSlice.sort((a, b) => boxes[a].y - boxes[b].y);
      
      let currentRegion: number[] = [];
      
      for (let i = 0; i < vSlice.length; i++) {
        const idx = vSlice[i];
        
        if (currentRegion.length === 0) {
          currentRegion.push(idx);
        } else {
          const prevIdx = vSlice[i - 1];
          const prevBottom = boxes[prevIdx].y + boxes[prevIdx].height;
          const currTop = boxes[idx].y;
          const gap = currTop - prevBottom;
          
          if (gap > yGapThreshold) {
            // Create region
            regions.push(this.createRegion(regionId++, currentRegion, boxes));
            currentRegion = [];
          }
          currentRegion.push(idx);
        }
      }
      
      if (currentRegion.length > 0) {
        regions.push(this.createRegion(regionId++, currentRegion, boxes));
      }
    }
    
    return regions;
  }

  private createRegion(id: number, boxIndices: number[], boxes: DetectionBox[]): Region {
    let minX = Infinity, minY = Infinity;
    let maxX = 0, maxY = 0;
    
    for (const idx of boxIndices) {
      const box = boxes[idx];
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
    
    return {
      id,
      minX,
      minY,
      maxX,
      maxY,
      boxIndices,
      numLines: 0
    };
  }

  private createBoxToRegionMap(regions: Region[], _numBoxes: number): Map<number, number> {
    const map = new Map<number, number>();
    
    for (const region of regions) {
      for (const boxIdx of region.boxIndices) {
        map.set(boxIdx, region.id);
      }
    }
    
    return map;
  }

  // ==================== Line Grouping ====================

  private groupIntoLines(boxes: DetectionBox[], boxToRegion: Map<number, number>): LineGroup[] {
    const { lineYTolerance } = this.config;
    const lines: LineGroup[] = [];
    const assigned = new Set<number>();
    let lineId = 0;
    
    // First pass: Find horizontal lines
    for (let i = 0; i < boxes.length; i++) {
      if (assigned.has(i)) continue;
      
      const box = boxes[i];
      const centerY = box.y + box.height / 2;
      const regionId = boxToRegion.get(i) ?? -1;
      
      const lineBoxes = [i];
      assigned.add(i);
      
      // Find all boxes on same horizontal line in same region
      for (let j = i + 1; j < boxes.length; j++) {
        if (assigned.has(j)) continue;
        
        const otherRegion = boxToRegion.get(j) ?? -1;
        if (regionId !== otherRegion) continue;
        
        const otherBox = boxes[j];
        const otherCenterY = otherBox.y + otherBox.height / 2;
        
        if (Math.abs(centerY - otherCenterY) <= lineYTolerance) {
          lineBoxes.push(j);
          assigned.add(j);
        }
      }
      
      // Create line group
      if (lineBoxes.length > 0) {
        // Sort by X position
        lineBoxes.sort((a, b) => boxes[a].x - boxes[b].x);
        
        lines.push(this.createLineGroup(lineId++, regionId, 'horizontal', lineBoxes, boxes));
      }
    }
    
    return lines;
  }

  private createLineGroup(
    id: number, 
    regionId: number, 
    orientation: 'horizontal' | 'vertical',
    boxIndices: number[], 
    boxes: DetectionBox[]
  ): LineGroup {
    let minX = Infinity, minY = Infinity;
    let maxX = 0, maxY = 0;
    let totalWidth = 0, totalHeight = 0, totalSpacing = 0;
    
    for (let i = 0; i < boxIndices.length; i++) {
      const box = boxes[boxIndices[i]];
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
      totalWidth += box.width;
      totalHeight += box.height;
      
      if (i > 0) {
        const prevBox = boxes[boxIndices[i - 1]];
        const gap = box.x - (prevBox.x + prevBox.width);
        totalSpacing += Math.max(0, gap);
      }
    }
    
    return {
      id,
      regionId,
      orientation,
      boxIndices,
      minX,
      minY,
      maxX,
      maxY,
      avgBoxWidth: totalWidth / boxIndices.length,
      avgBoxHeight: totalHeight / boxIndices.length,
      avgSpacing: boxIndices.length > 1 ? totalSpacing / (boxIndices.length - 1) : 0
    };
  }

  // ==================== Save Results ====================

  private async saveResults(
    boxes: DetectionBox[],
    regions: Region[],
    lines: LineGroup[],
    width: number,
    height: number,
    image?: any
  ): Promise<void> {
    // Save boxes as JSON
    const jsonPath = path.join(this.config.outputDir, 'component_boxes.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      boxes,
      regions,
      lines,
      imageWidth: width,
      imageHeight: height,
      timestamp: Date.now(),
      count: boxes.length,
      config: this.config
    }, null, 2));
    
    // Save boxes as CSV (compatible with C++ format)
    const csvPath = path.join(this.config.outputDir, 'gradients', 'component_boxes.csv');
    const csvLines = [
      '# Icon detection bounding boxes (Advanced JS Detection)',
      `# Total detections: ${boxes.length}`,
      'x,y,width,height,confidence'
    ];
    for (const box of boxes) {
      csvLines.push(`${box.x},${box.y},${box.width},${box.height},${box.confidence.toFixed(4)}`);
    }
    fs.writeFileSync(csvPath, csvLines.join('\n'));
    
    // Save regions
    const regionsPath = path.join(this.config.outputDir, 'regions', 'regions.csv');
    const regionLines = [
      '# Regions - Distinct UI areas detected by gap analysis',
      'region_id,min_x,min_y,max_x,max_y,width,height,num_boxes'
    ];
    for (const region of regions) {
      regionLines.push(`${region.id},${region.minX},${region.minY},${region.maxX},${region.maxY},${region.maxX - region.minX},${region.maxY - region.minY},${region.boxIndices.length}`);
    }
    fs.writeFileSync(regionsPath, regionLines.join('\n'));
    
    // Save lines
    const linesPath = path.join(this.config.outputDir, 'lines', 'line_groups.csv');
    const lineLines = [
      '# Line Groups - Boxes grouped by spatial proximity',
      'line_id,region_id,orientation,num_boxes,min_x,min_y,max_x,max_y,avg_width,avg_height,avg_spacing'
    ];
    for (const line of lines) {
      lineLines.push(`${line.id},${line.regionId},${line.orientation === 'horizontal' ? 'H' : 'V'},${line.boxIndices.length},${line.minX},${line.minY},${line.maxX},${line.maxY},${line.avgBoxWidth.toFixed(1)},${line.avgBoxHeight.toFixed(1)},${line.avgSpacing.toFixed(1)}`);
    }
    fs.writeFileSync(linesPath, lineLines.join('\n'));
    
    // Save visualization if image provided
    if (image && this.config.saveDebugImages) {
      await this.saveVisualization(image, boxes, regions);
    }
    
    console.log(`[AdvancedDetection] Saved ${boxes.length} boxes, ${regions.length} regions, ${lines.length} lines`);
  }

  private async saveVisualization(image: unknown, boxes: DetectionBox[], _regions: Region[]): Promise<void> {
    const clone = (image as { clone: () => { getWidth: () => number; getHeight: () => number; setPixelColor: (color: number, x: number, y: number) => void; writeAsync: (path: string) => Promise<void> } }).clone();
    
    // Draw boxes (green)
    for (const box of boxes) {
      for (let y = box.y; y < box.y + box.height && y < clone.getHeight(); y++) {
        for (let x = box.x; x < box.x + box.width && x < clone.getWidth(); x++) {
          if (y === box.y || y === box.y + box.height - 1 || x === box.x || x === box.x + box.width - 1) {
            clone.setPixelColor(Jimp.rgbaToInt(0, 255, 0, 255), x, y);
          }
        }
      }
    }
    
    const vizPath = path.join(this.config.outputDir, 'gradients', 'components_detected.bmp');
    await clone.writeAsync(vizPath);
  }

  // ==================== Public API ====================

  getConfig(): AdvancedDetectionConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<AdvancedDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Factory function
export function getAdvancedDetection(config?: Partial<AdvancedDetectionConfig>): AdvancedDetectionPipeline {
  return new AdvancedDetectionPipeline(config);
}

export default AdvancedDetectionPipeline;