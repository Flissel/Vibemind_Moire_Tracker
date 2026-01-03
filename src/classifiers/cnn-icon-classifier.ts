/**
 * CNN-based Icon Classifier
 * 
 * Verwendet TensorFlow.js für neuronale Icon-Klassifikation
 * Kategorien: settings, navigation, media, social, action, file, communication, etc.
 */

import * as tf from '@tensorflow/tfjs';

// ==================== Typdefinitionen ====================

export interface CNNClassifierConfig {
  modelPath?: string;
  inputSize?: number;
  threshold?: number;
  useGPU?: boolean;
}

export interface IconClassificationResult {
  category: IconCategory;
  confidence: number;
  alternatives?: Array<{
    category: IconCategory;
    confidence: number;
  }>;
}

export interface TrainingData {
  images: Float32Array[];
  labels: IconCategory[];
}

// Icon Categories - 50+ Kategorien
export const ICON_CATEGORIES = [
  // Navigation
  'home', 'menu', 'back', 'forward', 'arrow_up', 'arrow_down', 'arrow_left', 'arrow_right',
  // Actions
  'search', 'add', 'edit', 'delete', 'save', 'download', 'upload', 'share', 'copy', 'paste',
  'undo', 'redo', 'refresh', 'sync', 'filter', 'sort',
  // Media
  'play', 'pause', 'stop', 'record', 'volume', 'mute', 'fullscreen', 'minimize', 'maximize',
  // Settings & System
  'settings', 'close', 'check', 'warning', 'error_icon', 'info', 'help', 'lock', 'unlock',
  // Files & Folders
  'file', 'folder', 'document', 'image_icon', 'video_icon', 'audio_icon',
  // Communication
  'notification', 'message', 'email', 'phone', 'chat',
  // Social
  'profile', 'user', 'group', 'heart', 'star', 'bookmark',
  // Other
  'calendar', 'clock', 'location', 'link', 'code', 'unknown'
] as const;

// Export IconCategory type
export type IconCategory = typeof ICON_CATEGORIES[number];

const CATEGORY_TO_INDEX: Map<IconCategory, number> = new Map(
  ICON_CATEGORIES.map((cat, idx) => [cat, idx])
);

const INDEX_TO_CATEGORY: Map<number, IconCategory> = new Map(
  ICON_CATEGORIES.map((cat, idx) => [idx, cat])
);

// ==================== CNN Model ====================

/**
 * Erstellt ein kleines CNN-Modell für Icon-Klassifikation
 * Architektur optimiert für kleine 32x32 oder 64x64 Icons
 */
export function createIconCNNModel(inputSize: number = 32): tf.Sequential {
  const model = tf.sequential();
  
  // Input: [inputSize, inputSize, 3] RGB image
  
  // Conv Block 1
  model.add(tf.layers.conv2d({
    inputShape: [inputSize, inputSize, 3],
    filters: 32,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu',
    kernelInitializer: 'heNormal'
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.conv2d({
    filters: 32,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }));
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.25 }));
  
  // Conv Block 2
  model.add(tf.layers.conv2d({
    filters: 64,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.conv2d({
    filters: 64,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }));
  model.add(tf.layers.maxPooling2d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.25 }));
  
  // Conv Block 3
  model.add(tf.layers.conv2d({
    filters: 128,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.globalAveragePooling2d({}));
  
  // Dense Layers
  model.add(tf.layers.dense({
    units: 256,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
  }));
  model.add(tf.layers.dropout({ rate: 0.5 }));
  
  // Output Layer
  model.add(tf.layers.dense({
    units: ICON_CATEGORIES.length,
    activation: 'softmax'
  }));
  
  return model;
}

// ==================== CNN Icon Classifier Klasse ====================

export class CNNIconClassifier {
  private model: tf.LayersModel | null = null;
  private inputSize: number;
  private threshold: number;
  private isReady: boolean = false;
  private modelPath?: string;
  
  constructor(config: CNNClassifierConfig = {}) {
    this.inputSize = config.inputSize || 32;
    this.threshold = config.threshold || 0.3;
    this.modelPath = config.modelPath;
    
    // GPU-Backend aktivieren wenn verfügbar
    if (config.useGPU !== false) {
      this.initializeBackend();
    }
  }
  
  private async initializeBackend(): Promise<void> {
    try {
      // Versuche WebGL Backend (GPU)
      await tf.setBackend('webgl');
      console.log('[CNNIconClassifier] Using WebGL backend');
    } catch {
      // Fallback auf CPU
      await tf.setBackend('cpu');
      console.log('[CNNIconClassifier] Using CPU backend');
    }
  }
  
  /**
   * Initialisiert das CNN-Modell
   */
  async initialize(): Promise<void> {
    if (this.isReady) return;
    
    try {
      if (this.modelPath) {
        // Lade vortrainiertes Modell
        this.model = await tf.loadLayersModel(this.modelPath);
        console.log('[CNNIconClassifier] Loaded pre-trained model from:', this.modelPath);
      } else {
        // Erstelle neues Modell
        this.model = createIconCNNModel(this.inputSize);
        console.log('[CNNIconClassifier] Created new model');
      }
      
      // Kompiliere das Modell
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });
      
      this.isReady = true;
    } catch (error) {
      console.error('[CNNIconClassifier] Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Klassifiziert ein einzelnes Icon
   */
  async classify(
    imageData: Uint8Array | Buffer,
    width: number,
    height: number,
    channels: number = 4
  ): Promise<IconClassificationResult> {
    if (!this.isReady || !this.model) {
      await this.initialize();
    }
    
    return tf.tidy(() => {
      // 1. Bild vorbereiten
      const tensor = this.preprocessImage(imageData, width, height, channels);
      
      // 2. Vorhersage
      const prediction = this.model!.predict(tensor) as tf.Tensor;
      const probabilities = prediction.dataSync() as Float32Array;
      
      // 3. Top-K Ergebnisse
      const results = this.getTopKResults(probabilities, 5);
      
      // 4. Hauptergebnis
      const topResult = results[0];
      
      if (topResult.confidence < this.threshold) {
        return {
          category: 'unknown' as IconCategory,
          confidence: topResult.confidence,
          alternatives: results.slice(1, 4).map(r => ({
            category: r.category,
            confidence: r.confidence
          }))
        };
      }
      
      return {
        category: topResult.category,
        confidence: topResult.confidence,
        alternatives: results.slice(1, 4).map(r => ({
          category: r.category,
          confidence: r.confidence
        }))
      };
    });
  }
  
  /**
   * Batch-Klassifizierung mehrerer Icons
   */
  async classifyBatch(
    images: Array<{ data: Uint8Array | Buffer; width: number; height: number; channels?: number }>
  ): Promise<IconClassificationResult[]> {
    if (!this.isReady || !this.model) {
      await this.initialize();
    }
    
    return tf.tidy(() => {
      // Batch-Tensor erstellen
      const tensors = images.map(img => 
        this.preprocessImage(img.data, img.width, img.height, img.channels || 4)
      );
      const batchTensor = tf.concat(tensors);
      
      // Batch-Vorhersage
      const predictions = this.model!.predict(batchTensor) as tf.Tensor;
      const allProbabilities = predictions.arraySync() as number[][];
      
      // Ergebnisse verarbeiten
      return allProbabilities.map(probs => {
        const results = this.getTopKResults(new Float32Array(probs), 5);
        const topResult = results[0];
        
        if (topResult.confidence < this.threshold) {
          return {
            category: 'unknown' as IconCategory,
            confidence: topResult.confidence,
            alternatives: results.slice(1, 4).map(r => ({
              category: r.category,
              confidence: r.confidence
            }))
          };
        }
        
        return {
          category: topResult.category,
          confidence: topResult.confidence,
          alternatives: results.slice(1, 4).map(r => ({
            category: r.category,
            confidence: r.confidence
          }))
        };
      });
    });
  }
  
  /**
   * Trainiert das Modell mit neuen Daten
   */
  async train(
    trainingData: TrainingData,
    epochs: number = 50,
    batchSize: number = 32,
    validationSplit: number = 0.2,
    onProgress?: (epoch: number, logs: tf.Logs | undefined) => void
  ): Promise<tf.History> {
    if (!this.isReady || !this.model) {
      await this.initialize();
    }
    
    // Trainings-Tensoren erstellen
    const xTrain = tf.tensor4d(
      trainingData.images.flatMap(img => Array.from(img)),
      [trainingData.images.length, this.inputSize, this.inputSize, 3]
    );
    
    // One-hot encode labels
    const labelIndices = trainingData.labels.map(label => 
      CATEGORY_TO_INDEX.get(label) || ICON_CATEGORIES.length - 1
    );
    const yTrain = tf.oneHot(labelIndices, ICON_CATEGORIES.length);
    
    // Training
    const history = await this.model!.fit(xTrain, yTrain, {
      epochs,
      batchSize,
      validationSplit,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch: number, logs: tf.Logs | undefined) => {
          if (onProgress && logs) {
            onProgress(epoch, logs);
          }
          console.log(`[CNNIconClassifier] Epoch ${epoch + 1}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`);
        }
      }
    });
    
    // Speicher freigeben
    xTrain.dispose();
    yTrain.dispose();
    
    return history;
  }
  
  /**
   * Speichert das Modell
   */
  async saveModel(path: string): Promise<void> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    
    await this.model.save(path);
    console.log('[CNNIconClassifier] Model saved to:', path);
  }
  
  /**
   * Lädt ein gespeichertes Modell
   */
  async loadModel(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(path);
    this.isReady = true;
    console.log('[CNNIconClassifier] Model loaded from:', path);
  }
  
  /**
   * Gibt Modell-Speicher frei
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
      this.isReady = false;
    }
  }
  
  // ==================== Private Hilfsmethoden ====================
  
  private preprocessImage(
    imageData: Uint8Array | Buffer,
    width: number,
    height: number,
    channels: number
  ): tf.Tensor4D {
    // 1. Zu Tensor konvertieren
    let tensor: tf.Tensor3D;
    
    if (channels === 4) {
      // RGBA -> RGB
      const rgbData = new Float32Array(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        rgbData[i * 3] = imageData[i * 4] / 255;
        rgbData[i * 3 + 1] = imageData[i * 4 + 1] / 255;
        rgbData[i * 3 + 2] = imageData[i * 4 + 2] / 255;
      }
      tensor = tf.tensor3d(rgbData, [height, width, 3]);
    } else if (channels === 3) {
      const normalizedData = new Float32Array(imageData.length);
      for (let i = 0; i < imageData.length; i++) {
        normalizedData[i] = imageData[i] / 255;
      }
      tensor = tf.tensor3d(normalizedData, [height, width, 3]);
    } else {
      // Grayscale -> RGB
      const rgbData = new Float32Array(width * height * 3);
      for (let i = 0; i < width * height; i++) {
        const val = imageData[i] / 255;
        rgbData[i * 3] = val;
        rgbData[i * 3 + 1] = val;
        rgbData[i * 3 + 2] = val;
      }
      tensor = tf.tensor3d(rgbData, [height, width, 3]);
    }
    
    // 2. Resize auf inputSize x inputSize
    const resized = tf.image.resizeBilinear(tensor, [this.inputSize, this.inputSize]);
    tensor.dispose();
    
    // 3. Batch-Dimension hinzufügen
    const batched = resized.expandDims(0) as tf.Tensor4D;
    resized.dispose();
    
    return batched;
  }
  
  private getTopKResults(
    probabilities: Float32Array,
    k: number
  ): Array<{ category: IconCategory; confidence: number }> {
    // Sortiere nach Wahrscheinlichkeit
    const indexed = Array.from(probabilities).map((prob, idx) => ({ prob, idx }));
    indexed.sort((a, b) => b.prob - a.prob);
    
    // Top-K zurückgeben
    return indexed.slice(0, k).map(item => ({
      category: INDEX_TO_CATEGORY.get(item.idx) || 'unknown',
      confidence: item.prob
    }));
  }
  
  // ==================== Export/Import für Persistenz ====================
  /**
   * Export model weights and config for persistence
   */
  async exportModel(): Promise<{ weights: ArrayBuffer[]; config: object }> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    
    const weights: ArrayBuffer[] = [];
    
    // Get all weights
    for (const layer of this.model.layers) {
      const layerWeights = layer.getWeights();
      for (const w of layerWeights) {
        const data = await w.data();
        weights.push(new Float32Array(data).buffer);
      }
    }
    
    return {
      weights,
      config: {
        categories: ICON_CATEGORIES,
        inputShape: this.config.inputSize
      }
    };
  }
  
  /**
   * Import model weights from saved data
   */
  async importModel(data: { weights: ArrayBuffer[]; config: object }): Promise<void> {
    if (!this.model) {
      await this.initialize();
    }
    
    if (!this.model) {
      throw new Error('Failed to initialize model');
    }
    
    let weightIndex = 0;
    
    for (const layer of this.model.layers) {
      const layerWeights = layer.getWeights();
      const newWeights: tf.Tensor[] = [];
      
      for (const w of layerWeights) {
        const shape = w.shape;
        const buffer = data.weights[weightIndex++];
        const values = new Float32Array(buffer);
        const tensor = tf.tensor(values, shape);
        newWeights.push(tensor);
      }
      
      if (newWeights.length > 0) {
        layer.setWeights(newWeights);
      }
    }
    
    console.log('[CNNIconClassifier] Weights imported');
  }
  
  /**
   * Classify from ImageData directly (for ContinuousLearner)
   */
  async classifyImageData(imageData: ImageData): Promise<IconClassificationResult> {
    return this.classify(imageData.data, imageData.width, imageData.height);
  }
  
  // ==================== Utility Methoden ====================
  
  /**
   * Gibt die unterstützten Kategorien zurück
   */
  getCategories(): typeof ICON_CATEGORIES {
    return ICON_CATEGORIES;
  }
  
  /**
   * Prüft ob das Modell bereit ist
   */
  isModelReady(): boolean {
    return this.isReady;
  }
  
  /**
   * Gibt Modell-Info zurück
   */
  getModelInfo(): { inputSize: number; categories: number; parameters: number } | null {
    if (!this.model) return null;
    
    return {
      inputSize: this.inputSize,
      categories: ICON_CATEGORIES.length,
      parameters: this.model.countParams()
    };
  }
}

// ==================== Hybrid Classifier ====================

/**
 * Kombiniert CNN mit pHash für optimale Ergebnisse
 * - Bekannte Icons: pHash für schnelle exakte Matches
 * - Unbekannte Icons: CNN für semantische Klassifikation
 */
export class HybridIconClassifier {
  private cnn: CNNIconClassifier;
  private phashCache: Map<string, { category: IconCategory; confidence: number }> = new Map();
  private phashThreshold: number = 8; // Hamming-Distanz Threshold
  
  constructor(cnnConfig?: CNNClassifierConfig) {
    this.cnn = new CNNIconClassifier(cnnConfig);
  }
  
  async initialize(): Promise<void> {
    await this.cnn.initialize();
  }
  
  /**
   * Klassifiziert mit pHash + CNN Fallback
   */
  async classify(
    imageData: Uint8Array | Buffer,
    width: number,
    height: number,
    channels: number = 4
  ): Promise<IconClassificationResult & { method: 'phash' | 'cnn' }> {
    // 1. pHash berechnen (Import aus icon-classifier.ts)
    const { calculatePHash, hammingDistance } = await import('./icon-classifier');
    const phash = calculatePHash(imageData as Uint8Array, width, height, channels);
    
    // 2. Im pHash-Cache suchen
    for (const [cachedHash, result] of this.phashCache.entries()) {
      const distance = hammingDistance(phash, cachedHash);
      if (distance <= this.phashThreshold) {
        return {
          ...result,
          method: 'phash'
        };
      }
    }
    
    // 3. CNN-Klassifikation
    const cnnResult = await this.cnn.classify(imageData, width, height, channels);
    
    // 4. Bei hoher Konfidenz zum pHash-Cache hinzufügen
    if (cnnResult.confidence > 0.8) {
      this.phashCache.set(phash, {
        category: cnnResult.category,
        confidence: cnnResult.confidence
      });
    }
    
    return {
      ...cnnResult,
      method: 'cnn'
    };
  }
  
  /**
   * Fügt bekanntes Icon zum pHash-Cache hinzu
   */
  async addToCache(
    imageData: Uint8Array | Buffer,
    width: number,
    height: number,
    channels: number,
    category: IconCategory,
    confidence: number = 1.0
  ): Promise<void> {
    const { calculatePHash } = await import('./icon-classifier');
    const phash = calculatePHash(imageData as Uint8Array, width, height, channels);
    this.phashCache.set(phash, { category, confidence });
  }
  
  /**
   * Exportiert den pHash-Cache
   */
  exportCache(): Array<{ phash: string; category: IconCategory; confidence: number }> {
    return Array.from(this.phashCache.entries()).map(([phash, result]) => ({
      phash,
      ...result
    }));
  }
  
  /**
   * Importiert einen pHash-Cache
   */
  importCache(cache: Array<{ phash: string; category: IconCategory; confidence: number }>): void {
    for (const item of cache) {
      this.phashCache.set(item.phash, {
        category: item.category,
        confidence: item.confidence
      });
    }
  }
  
  dispose(): void {
    this.cnn.dispose();
    this.phashCache.clear();
  }
}

// ==================== Factory Functions ====================

export function createCNNIconClassifier(config?: CNNClassifierConfig): CNNIconClassifier {
  return new CNNIconClassifier(config);
}

export function createHybridIconClassifier(config?: CNNClassifierConfig): HybridIconClassifier {
  return new HybridIconClassifier(config);
}

export default CNNIconClassifier;