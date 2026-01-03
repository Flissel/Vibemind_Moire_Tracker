/**
 * Icon Classifier
 * 
 * Klassifiziert Icons ohne LLM durch:
 * 1. Perceptual Hashing (pHash) für bekannte Icons
 * 2. Template Matching gegen eine Bibliothek
 * 3. Farb-Histogram-Analyse
 * 4. Form-basierte Regeln
 */

import type {
  IconCategory,
  IconClassifier as IIconClassifier,
  IconClassificationResult,
  IconCache as IIconCache,
  IconHash
} from '../agents/types';

// ==================== Typdefinitionen ====================

interface IconTemplate {
  phash: string;
  category: IconCategory;
  confidence: number;
}

interface IconFeatures {
  colorAnalysis: {
    hue: number;
    saturation: number;
    brightness: number;
  };
  dominantColor: 'red' | 'green' | 'blue' | 'yellow' | 'orange' | 'gray' | 'white' | 'black';
  isCircular: boolean;
  hasArrow: boolean;
  arrowDirection?: 'up' | 'down' | 'left' | 'right';
  hasCheckmark: boolean;
  hasCross: boolean;
  hasGear: boolean;
}

// ==================== Perceptual Hashing ====================

/**
 * Berechnet einen 64-bit perceptual hash eines Bildes
 * Basiert auf DCT-basiertem pHash Algorithmus
 */
export function calculatePHash(
  imageData: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number = 4
): string {
  // 1. Resize zu 32x32 (für DCT)
  const resized = resizeImage(imageData, width, height, 32, 32, channels);
  
  // 2. In Grayscale konvertieren
  const gray = toGrayscale(resized, 32, 32, channels);
  
  // 3. DCT (Discrete Cosine Transform) - vereinfachte Version
  const dct = simpleDCT(gray, 32);
  
  // 4. Nur obere-linke 8x8 DCT-Koeffizienten (niedrige Frequenzen)
  const lowFreq: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue; // DC-Komponente überspringen
      lowFreq.push(dct[y * 32 + x]);
    }
  }
  
  // 5. Median berechnen
  const sorted = [...lowFreq].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  // 6. Hash generieren: 1 wenn > median, sonst 0
  let hash = '';
  for (const val of lowFreq) {
    hash += val > median ? '1' : '0';
  }
  
  // In Hex konvertieren
  return binaryToHex(hash.padEnd(64, '0').slice(0, 64));
}

/**
 * Berechnet einen Difference Hash (dHash)
 * Schneller als pHash, gut für exakte Matches
 */
export function calculateDHash(
  imageData: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number = 4
): string {
  // 1. Resize zu 9x8 (9 breit um 8 Differenzen zu berechnen)
  const resized = resizeImage(imageData, width, height, 9, 8, channels);
  
  // 2. In Grayscale konvertieren
  const gray = toGrayscale(resized, 9, 8, channels);
  
  // 3. Horizontale Differenzen berechnen
  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x];
      const right = gray[y * 9 + x + 1];
      hash += left < right ? '1' : '0';
    }
  }
  
  return binaryToHex(hash);
}

/**
 * Hamming-Distanz zwischen zwei Hashes
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error('Hashes müssen gleiche Länge haben');
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  return distance;
}

// ==================== Farb-Analyse ====================

export interface ColorHistogram {
  red: number;
  green: number;
  blue: number;
  yellow: number;
  cyan: number;
  magenta: number;
  white: number;
  black: number;
  gray: number;
}

/**
 * Berechnet ein vereinfachtes Farb-Histogram
 */
export function calculateColorHistogram(
  imageData: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number = 4
): ColorHistogram {
  const histogram: ColorHistogram = {
    red: 0, green: 0, blue: 0,
    yellow: 0, cyan: 0, magenta: 0,
    white: 0, black: 0, gray: 0
  };
  
  let totalPixels = 0;
  
  for (let i = 0; i < imageData.length; i += channels) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const a = channels === 4 ? imageData[i + 3] : 255;
    
    // Transparente Pixel überspringen
    if (a < 128) continue;
    totalPixels++;
    
    // Farbe kategorisieren
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    
    if (diff < 30) {
      // Graustufen
      if (max > 200) histogram.white++;
      else if (max < 55) histogram.black++;
      else histogram.gray++;
    } else {
      // Farbig
      if (r > 200 && g < 100 && b < 100) histogram.red++;
      else if (g > 200 && r < 100 && b < 100) histogram.green++;
      else if (b > 200 && r < 100 && g < 100) histogram.blue++;
      else if (r > 200 && g > 200 && b < 100) histogram.yellow++;
      else if (g > 200 && b > 200 && r < 100) histogram.cyan++;
      else if (r > 200 && b > 200 && g < 100) histogram.magenta++;
      else histogram.gray++;
    }
  }
  
  // Normalisieren
  if (totalPixels > 0) {
    for (const key of Object.keys(histogram) as (keyof ColorHistogram)[]) {
      histogram[key] /= totalPixels;
    }
  }
  
  return histogram;
}

// ==================== Form-Erkennung ====================

export interface ShapeFeatures {
  isCircular: boolean;
  hasArrow: boolean;
  hasCheckmark: boolean;
  hasCross: boolean;
  hasGear: boolean;
  hasLines: boolean;
  edgeCount: number;
  symmetryScore: number;
  aspectRatio: number;
}

export function detectShapeFeatures(
  imageData: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number = 4
): ShapeFeatures {
  const gray = toGrayscale(imageData as Uint8Array, width, height, channels);
  const binary = binarize(gray, width, height);
  
  // Aspect Ratio
  const aspectRatio = width / height;
  
  // Kanten zählen (Sobel-ähnlich)
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = Math.abs(binary[idx - 1] - binary[idx + 1]);
      const gy = Math.abs(binary[idx - width] - binary[idx + width]);
      if (gx + gy > 0) edgeCount++;
    }
  }
  
  // Symmetrie prüfen (horizontal)
  let symmetryMatches = 0;
  let symmetryTotal = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) {
      const left = binary[y * width + x];
      const right = binary[y * width + (width - 1 - x)];
      symmetryTotal++;
      if (left === right) symmetryMatches++;
    }
  }
  const symmetryScore = symmetryTotal > 0 ? symmetryMatches / symmetryTotal : 0;
  
  // Kreisförmig (vereinfacht: Symmetrie in beide Richtungen hoch + aspect ratio ~1)
  const isCircular = symmetryScore > 0.85 && aspectRatio > 0.85 && aspectRatio < 1.15;
  
  // Pfeil erkennen (Dreieck-Form an einer Seite)
  const hasArrow = detectArrowPattern(binary, width, height);
  
  // Checkmark (diagonale Linien in L-Form)
  const hasCheckmark = detectCheckmarkPattern(binary, width, height);
  
  // Kreuz (X-Form)
  const hasCross = detectCrossPattern(binary, width, height);
  
  // Gear (Zahnrad - kreisförmig mit Zacken am Rand)
  const hasGear = isCircular && edgeCount > (width * height * 0.3);
  
  return {
    isCircular,
    hasArrow,
    hasCheckmark,
    hasCross,
    hasGear,
    hasLines: edgeCount > (width * height * 0.1),
    edgeCount,
    symmetryScore,
    aspectRatio
  };
}

// ==================== Feature-Analyse ====================

function analyzeIconFeatures(
  grayscale: Uint8Array,
  width: number,
  height: number
): IconFeatures {
  const binary = binarize(grayscale, width, height);
  
  // Farb-Analyse (aus Grayscale approximieren)
  let totalBrightness = 0;
  for (let i = 0; i < grayscale.length; i++) {
    totalBrightness += grayscale[i];
  }
  const avgBrightness = totalBrightness / grayscale.length;
  
  // Form-Erkennung
  const hasArrow = detectArrowPattern(binary, width, height);
  const hasCheckmark = detectCheckmarkPattern(binary, width, height);
  const hasCross = detectCrossPattern(binary, width, height);
  
  // Symmetrie für isCircular
  let symmetryMatches = 0;
  let symmetryTotal = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) {
      const left = binary[y * width + x];
      const right = binary[y * width + (width - 1 - x)];
      symmetryTotal++;
      if (left === right) symmetryMatches++;
    }
  }
  const symmetryScore = symmetryTotal > 0 ? symmetryMatches / symmetryTotal : 0;
  const aspectRatio = width / height;
  const isCircular = symmetryScore > 0.85 && aspectRatio > 0.85 && aspectRatio < 1.15;
  
  // Kanten zählen für hasGear
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = Math.abs(binary[idx - 1] - binary[idx + 1]);
      const gy = Math.abs(binary[idx - width] - binary[idx + width]);
      if (gx + gy > 0) edgeCount++;
    }
  }
  const hasGear = isCircular && edgeCount > (width * height * 0.3);
  
  return {
    colorAnalysis: {
      hue: 0,
      saturation: 0,
      brightness: avgBrightness
    },
    dominantColor: avgBrightness > 200 ? 'white' : avgBrightness < 55 ? 'black' : 'gray',
    isCircular,
    hasArrow,
    arrowDirection: hasArrow ? 'right' : undefined,
    hasCheckmark,
    hasCross,
    hasGear
  };
}

// ==================== Icon Cache ====================

class IconCache implements IIconCache {
  private cache: Map<string, { category: IconCategory; confidence: number }> = new Map();
  private hashes: Map<string, IconHash> = new Map();
  
  get(hash: string): { category: IconCategory; confidence: number } | undefined {
    return this.cache.get(hash);
  }
  
  set(hash: string, category: IconCategory, confidence: number): void {
    this.cache.set(hash, { category, confidence });
    this.hashes.set(hash, { phash: hash, category, confidence });
  }
  
  has(hash: string): boolean {
    return this.cache.has(hash);
  }
  
  size(): number {
    return this.cache.size;
  }
  
  export(): IconHash[] {
    return Array.from(this.hashes.values());
  }
  
  import(hashes: IconHash[]): void {
    for (const hash of hashes) {
      this.cache.set(hash.phash, { category: hash.category, confidence: hash.confidence });
      this.hashes.set(hash.phash, hash);
    }
  }
}

// ==================== Icon Classifier Klasse ====================

export class IconClassifier implements IIconClassifier {
  private cache: IconCache;
  private templates: Map<string, IconTemplate> = new Map();
  private templateLibrary: Map<IconCategory, string[]> = new Map();
  
  constructor() {
    this.cache = new IconCache();
    this.initializeTemplates();
  }
  
  /**
   * Initialisiert bekannte Icon-Templates
   */
  private initializeTemplates(): void {
    // Diese werden später mit echten Hashes befüllt
    // Für jetzt: leere Bibliothek
  }
  
  /**
   * Klassifiziert ein einzelnes Icon
   */
  async classify(
    imageData: Buffer | Uint8Array,
    width: number,
    height: number
  ): Promise<IconClassificationResult> {
    // 1. Hash berechnen
    const phash = calculatePHash(imageData as Uint8Array, width, height);
    
    // 2. Im Cache suchen
    const cached = this.cache.get(phash);
    if (cached) {
      return {
        category: cached.category,
        confidence: cached.confidence
      };
    }
    
    // 3. Gegen bekannte Templates prüfen
    let bestMatch: { template: IconTemplate; distance: number } | null = null;
    
    for (const template of this.templates.values()) {
      const distance = hammingDistance(phash, template.phash);
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { template, distance };
      }
    }
    
    if (bestMatch && bestMatch.distance < 12) {
      // Guter Match gefunden
      const confidence = 1 - (bestMatch.distance / 64);
      return {
        category: bestMatch.template.category,
        confidence
      };
    }
    
    // 4. Feature-basierte Analyse
    const gray = toGrayscale(imageData as Uint8Array, width, height, 4);
    const features = analyzeIconFeatures(gray, width, height);
    const featureResult = this.classifyByFeatures(features);
    
    // Cache das Ergebnis
    if (featureResult.confidence > 0.5) {
      this.cache.set(phash, featureResult.category, featureResult.confidence);
    }
    
    return featureResult;
  }
  
  /**
   * Batch-Klassifizierung mehrerer Icons
   */
  async classifyBatch(
    images: Array<{ data: Buffer | Uint8Array; width: number; height: number }>
  ): Promise<IconClassificationResult[]> {
    return Promise.all(
      images.map(img => this.classify(img.data, img.width, img.height))
    );
  }
  
  /**
   * Klassifiziert basierend auf extrahierten Features
   */
  private classifyByFeatures(features: IconFeatures): IconClassificationResult {
    const { dominantColor } = features;
    
    // Farb-basierte Klassifikation
    if (dominantColor === 'yellow' || dominantColor === 'orange') {
      return { category: 'folder', confidence: 0.7 };
    }
    
    // Form-basierte Klassifikation
    if (features.hasCross) {
      return { category: 'error_icon', confidence: 0.6, alternatives: [
        { category: 'close', confidence: 0.3 }
      ]};
    }
    
    if (features.hasCheckmark) {
      return { category: 'check', confidence: 0.6, alternatives: [
        { category: 'play', confidence: 0.3 }
      ]};
    }
    
    // Kreisförmige Icons
    if (features.isCircular) {
      if (features.colorAnalysis.saturation > 100) {
        if (features.colorAnalysis.hue >= 0 && features.colorAnalysis.hue < 60) {
          return { category: 'error_icon', confidence: 0.5 };
        } else if (features.colorAnalysis.hue >= 90 && features.colorAnalysis.hue < 150) {
          return { category: 'check', confidence: 0.5 };
        }
      }
    }
    
    // Zahnrad-ähnliche Form
    if (features.hasGear) {
      return { category: 'settings', confidence: 0.75 };
    }
    
    // Pfeil-Form
    if (features.hasArrow) {
      if (features.arrowDirection === 'right') {
        return { category: 'arrow_right', confidence: 0.6 };
      } else if (features.arrowDirection === 'down') {
        return { category: 'arrow_down', confidence: 0.6 };
      }
      return { category: 'arrow_right', confidence: 0.5 };
    }
    
    // Fallback
    return {
      category: 'unknown',
      confidence: 0.2,
      alternatives: [
        { category: 'refresh', confidence: 0.2 },
        { category: 'record', confidence: 0.2 }
      ]
    };
  }
  
  /**
   * Fügt ein bekanntes Icon zum Cache hinzu
   */
  addToCache(
    imageData: Buffer | Uint8Array,
    width: number,
    height: number,
    category: IconCategory,
    confidence: number = 1.0
  ): void {
    const phash = calculatePHash(imageData as Uint8Array, width, height);
    
    this.cache.set(phash, category, confidence);
    
    // Auch zur Template-Bibliothek hinzufügen
    if (!this.templateLibrary.has(category)) {
      this.templateLibrary.set(category, []);
    }
    this.templateLibrary.get(category)!.push(phash);
  }
  
  /**
   * Exportiert den Cache
   */
  exportCache(): IconHash[] {
    return this.cache.export();
  }
  
  /**
   * Importiert einen Cache
   */
  importCache(hashes: IconHash[]): void {
    this.cache.import(hashes);
    
    for (const hash of hashes) {
      if (!this.templateLibrary.has(hash.category)) {
        this.templateLibrary.set(hash.category, []);
      }
      this.templateLibrary.get(hash.category)!.push(hash.phash);
    }
  }
}

// ==================== Image-Hilfsfunktionen ====================

function resizeImage(
  data: Uint8Array | Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  channels: number
): Uint8Array {
  const result = new Uint8Array(dstWidth * dstHeight * channels);
  
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      
      const srcIdx = (srcY * srcWidth + srcX) * channels;
      const dstIdx = (y * dstWidth + x) * channels;
      
      for (let c = 0; c < channels; c++) {
        result[dstIdx + c] = data[srcIdx + c];
      }
    }
  }
  
  return result;
}

function toGrayscale(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number
): Uint8Array {
  const gray = new Uint8Array(width * height);
  
  for (let i = 0; i < width * height; i++) {
    const idx = i * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  
  return gray;
}

function binarize(gray: Uint8Array, width: number, height: number, threshold: number = 128): Uint8Array {
  const binary = new Uint8Array(width * height);
  
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] > threshold ? 1 : 0;
  }
  
  return binary;
}

function simpleDCT(gray: Uint8Array, size: number): Float32Array {
  const dct = new Float32Array(size * size);
  const factor = Math.PI / size;
  
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          sum += gray[y * size + x] *
                 Math.cos(factor * (x + 0.5) * u) *
                 Math.cos(factor * (y + 0.5) * v);
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[v * size + u] = (cu * cv * sum) / 4;
    }
  }
  
  return dct;
}

function binaryToHex(binary: string): string {
  let hex = '';
  for (let i = 0; i < binary.length; i += 4) {
    const chunk = binary.slice(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}

function detectArrowPattern(binary: Uint8Array, width: number, height: number): boolean {
  const centerY = Math.floor(height / 2);
  let leftEdge = -1;
  let rightEdge = -1;
  
  for (let x = 0; x < width; x++) {
    if (binary[centerY * width + x] === 1 && leftEdge === -1) {
      leftEdge = x;
    }
    if (binary[centerY * width + x] === 1) {
      rightEdge = x;
    }
  }
  
  if (leftEdge === -1 || rightEdge === -1) return false;
  
  const topY = Math.floor(height / 4);
  const bottomY = Math.floor(3 * height / 4);
  
  let topWidth = 0;
  let bottomWidth = 0;
  
  for (let x = 0; x < width; x++) {
    if (binary[topY * width + x] === 1) topWidth++;
    if (binary[bottomY * width + x] === 1) bottomWidth++;
  }
  
  const centerWidth = rightEdge - leftEdge;
  
  return Math.abs(topWidth - bottomWidth) < 5 && centerWidth > topWidth * 0.8;
}

function detectCheckmarkPattern(binary: Uint8Array, width: number, height: number): boolean {
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  
  let hasLeftLower = false;
  let hasRightUpper = false;
  
  for (let y = midY; y < height; y++) {
    for (let x = 0; x < midX; x++) {
      if (binary[y * width + x] === 1) {
        hasLeftLower = true;
        break;
      }
    }
  }
  
  for (let y = 0; y < midY; y++) {
    for (let x = midX; x < width; x++) {
      if (binary[y * width + x] === 1) {
        hasRightUpper = true;
        break;
      }
    }
  }
  
  return hasLeftLower && hasRightUpper;
}

function detectCrossPattern(binary: Uint8Array, width: number, height: number): boolean {
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  
  const centerValue = binary[midY * width + midX];
  if (centerValue === 0) return false;
  
  let diag1Count = 0;
  let diag2Count = 0;
  
  for (let i = 0; i < Math.min(width, height); i++) {
    const x1 = Math.floor(i * width / Math.min(width, height));
    const y1 = Math.floor(i * height / Math.min(width, height));
    const x2 = width - 1 - x1;
    
    if (binary[y1 * width + x1] === 1) diag1Count++;
    if (binary[y1 * width + x2] === 1) diag2Count++;
  }
  
  const threshold = Math.min(width, height) * 0.5;
  return diag1Count > threshold && diag2Count > threshold;
}

// ==================== Factory ====================

export function createIconClassifier(): IconClassifier {
  return new IconClassifier();
}

export default IconClassifier;