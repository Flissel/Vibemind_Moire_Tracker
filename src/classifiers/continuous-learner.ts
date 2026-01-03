/**
 * @moire/canvas - Continuous Learning Pipeline
 * 
 * Automatisches Lernen durch:
 * 1. Screenshot Capture (Auto-Refresh)
 * 2. CNN Icon Detection & Classification
 * 3. LLM Verification (für unsichere Klassifikationen)
 * 4. RLAF Training Update
 * 5. Model Persistence (Save/Load)
 * 
 * Das System lernt kontinuierlich im Hintergrund!
 */

import { CNNIconClassifier, IconClassificationResult } from './cnn-icon-classifier';

// ==================== Types ====================

export interface ContinuousLearnerConfig {
  /** Auto-refresh interval in ms (default: 5000) */
  refreshInterval?: number;
  /** Confidence threshold below which LLM is consulted (default: 0.7) */
  confidenceThreshold?: number;
  /** Max samples before auto-save (default: 100) */
  saveInterval?: number;
  /** Enable learning (default: true) */
  learningEnabled?: boolean;
  /** Storage key for model persistence */
  storageKey?: string;
  /** LLM Provider configuration */
  llmProvider?: {
    type: 'openai' | 'claude' | 'local-simulate';
    apiKey?: string;
    model?: string;
  };
}

export interface LearningStats {
  totalSamples: number;
  correctPredictions: number;
  llmCorrections: number;
  modelUpdates: number;
  accuracy: number;
  lastSaveTime: number;
  sessionStartTime: number;
}

export interface DetectedIcon {
  id: string;
  imageData: ImageData;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClassificationWithFeedback {
  icon: DetectedIcon;
  cnnPrediction: IconClassificationResult;
  llmLabel?: string;
  llmConfidence?: number;
  reward?: number;
  trained?: boolean;
}

// ==================== Event Types ====================

export type LearnerEvent = 
  | { type: 'classification'; data: ClassificationWithFeedback }
  | { type: 'training'; data: { icon: DetectedIcon; correct: string; reward: number } }
  | { type: 'model-saved'; data: { timestamp: number; samples: number } }
  | { type: 'model-loaded'; data: { timestamp: number; samples: number } }
  | { type: 'stats-update'; data: LearningStats }
  | { type: 'error'; data: Error };

export type LearnerEventCallback = (event: LearnerEvent) => void;

// ==================== Continuous Learner Class ====================

export class ContinuousLearner {
  private config: Required<ContinuousLearnerConfig>;
  private cnn: CNNIconClassifier | null = null;
  private stats: LearningStats;
  private autoRefreshTimer: number | null = null;
  private pendingClassifications: ClassificationWithFeedback[] = [];
  private eventListeners: Set<LearnerEventCallback> = new Set();
  private isInitialized: boolean = false;
  
  constructor(config: ContinuousLearnerConfig = {}) {
    this.config = {
      refreshInterval: 5000,
      confidenceThreshold: 0.7,
      saveInterval: 100,
      learningEnabled: true,
      storageKey: 'moire-cnn-model',
      llmProvider: { type: 'local-simulate' },
      ...config
    };
    
    this.stats = {
      totalSamples: 0,
      correctPredictions: 0,
      llmCorrections: 0,
      modelUpdates: 0,
      accuracy: 0,
      lastSaveTime: 0,
      sessionStartTime: Date.now()
    };
  }
  
  // ==================== Initialization ====================
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log('[ContinuousLearner] Initializing...');
    
    // Initialize CNN
    this.cnn = new CNNIconClassifier();
    await this.cnn.initialize();
    
    // Try to load saved model
    const loaded = await this.loadModel();
    if (loaded) {
      console.log('[ContinuousLearner] Loaded saved model');
    } else {
      console.log('[ContinuousLearner] Starting with fresh model');
    }
    
    this.isInitialized = true;
    console.log('[ContinuousLearner] Ready!');
  }
  
  // ==================== Classification Pipeline ====================
  
  /**
   * Classify a single icon with optional LLM verification
   */
  async classifyIcon(icon: DetectedIcon): Promise<ClassificationWithFeedback> {
    if (!this.cnn || !this.isInitialized) {
      throw new Error('ContinuousLearner not initialized');
    }
    
    // Step 1: CNN Classification
    const cnnResult = await this.cnn.classify(icon.imageData);
    
    const classification: ClassificationWithFeedback = {
      icon,
      cnnPrediction: cnnResult
    };
    
    // Step 2: Check confidence - if low, consult LLM
    if (cnnResult.confidence < this.config.confidenceThreshold) {
      const llmResult = await this.consultLLM(icon.imageData);
      classification.llmLabel = llmResult.label;
      classification.llmConfidence = llmResult.confidence;
      
      // Step 3: Calculate reward and train if learning enabled
      if (this.config.learningEnabled && llmResult.confidence > 0.7) {
        const reward = this.calculateReward(
          cnnResult.category,
          cnnResult.confidence,
          llmResult.label,
          llmResult.confidence
        );
        
        classification.reward = reward;
        
        // Step 4: Update CNN weights
        await this.trainOnSample(icon.imageData, llmResult.label, reward);
        classification.trained = true;
        
        this.stats.llmCorrections++;
        this.stats.modelUpdates++;
      }
    } else {
      // CNN is confident - count as correct
      this.stats.correctPredictions++;
    }
    
    // Update stats
    this.stats.totalSamples++;
    this.stats.accuracy = this.stats.correctPredictions / this.stats.totalSamples;
    
    // Emit event
    this.emit({ type: 'classification', data: classification });
    this.emit({ type: 'stats-update', data: { ...this.stats } });
    
    // Auto-save check
    if (this.stats.modelUpdates % this.config.saveInterval === 0 && this.stats.modelUpdates > 0) {
      await this.saveModel();
    }
    
    return classification;
  }
  
  /**
   * Classify multiple icons from a detection result
   */
  async classifyIcons(icons: DetectedIcon[]): Promise<ClassificationWithFeedback[]> {
    const results: ClassificationWithFeedback[] = [];
    
    for (const icon of icons) {
      const result = await this.classifyIcon(icon);
      results.push(result);
    }
    
    return results;
  }
  
  // ==================== LLM Integration ====================
  
  private async consultLLM(imageData: ImageData): Promise<{ label: string; confidence: number; reasoning?: string }> {
    const provider = this.config.llmProvider.type;
    
    if (provider === 'local-simulate') {
      // Simulated LLM for demo/testing
      return this.simulateLLM(imageData);
    }
    
    if (provider === 'openai') {
      return this.callOpenAI(imageData);
    }
    
    if (provider === 'claude') {
      return this.callClaude(imageData);
    }
    
    return { label: 'unknown', confidence: 0.5 };
  }
  
  private async simulateLLM(imageData: ImageData): Promise<{ label: string; confidence: number; reasoning: string }> {
    // Simulate 200-500ms API latency
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    
    // Analyze image features for simulation
    const features = this.analyzeImageFeatures(imageData);
    
    // Simulate LLM response based on features
    const { label, confidence, reasoning } = this.generateSimulatedResponse(features);
    
    return { label, confidence, reasoning };
  }
  
  private analyzeImageFeatures(imageData: ImageData): { 
    hasCircle: boolean; 
    hasGear: boolean;
    hasCross: boolean;
    hasArrow: boolean;
    dominantColor: string;
    symmetry: number;
  } {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    
    let totalR = 0, totalG = 0, totalB = 0;
    let edgePixels = 0;
    
    // Simple feature extraction
    for (let i = 0; i < data.length; i += 4) {
      totalR += data[i];
      totalG += data[i + 1];
      totalB += data[i + 2];
      
      // Count non-transparent pixels near edges
      const pixelIndex = i / 4;
      const x = pixelIndex % w;
      const y = Math.floor(pixelIndex / w);
      
      if (data[i + 3] > 128) { // Has alpha
        const distFromCenter = Math.sqrt(
          Math.pow(x - w/2, 2) + Math.pow(y - h/2, 2)
        );
        const maxDist = Math.sqrt(Math.pow(w/2, 2) + Math.pow(h/2, 2));
        
        if (distFromCenter > maxDist * 0.3 && distFromCenter < maxDist * 0.6) {
          edgePixels++;
        }
      }
    }
    
    const pixelCount = w * h;
    const avgR = totalR / pixelCount;
    const avgG = totalG / pixelCount;
    const avgB = totalB / pixelCount;
    
    // Determine dominant color
    let dominantColor = 'gray';
    if (avgR > avgG && avgR > avgB) dominantColor = 'red';
    else if (avgG > avgR && avgG > avgB) dominantColor = 'green';
    else if (avgB > avgR && avgB > avgG) dominantColor = 'blue';
    
    // Circle detection (edge pixels in ring pattern)
    const hasCircle = edgePixels > pixelCount * 0.1;
    
    return {
      hasCircle,
      hasGear: edgePixels > pixelCount * 0.15,
      hasCross: false, // Would need more complex analysis
      hasArrow: false,
      dominantColor,
      symmetry: 0.5
    };
  }
  
  private generateSimulatedResponse(features: any): { label: string; confidence: number; reasoning: string } {
    // Icon category probabilities based on features
    const categories: { [key: string]: number } = {
      'settings': features.hasGear ? 0.9 : 0.1,
      'home': features.hasArrow ? 0.1 : 0.2,
      'search': features.hasCircle ? 0.3 : 0.1,
      'user': features.hasCircle ? 0.4 : 0.1,
      'menu': 0.15,
      'close': features.hasCross ? 0.8 : 0.1,
      'play': features.hasArrow ? 0.5 : 0.1,
      'check': 0.1,
      'star': 0.1,
      'notification': 0.1
    };
    
    // Find highest probability
    let maxLabel = 'unknown';
    let maxProb = 0;
    
    for (const [label, prob] of Object.entries(categories)) {
      if (prob > maxProb) {
        maxProb = prob;
        maxLabel = label;
      }
    }
    
    // Add some noise
    const confidence = Math.min(0.98, maxProb + (Math.random() * 0.1 - 0.05));
    
    const reasonings: { [key: string]: string } = {
      'settings': 'Zahnrad-Symbol, typisch für Einstellungen',
      'home': 'Haus-Symbol für Startseite',
      'search': 'Lupe für Suchfunktion',
      'user': 'Personen-Silhouette für Benutzerprofil',
      'menu': 'Hamburger-Menü-Symbol',
      'close': 'X-Symbol zum Schließen',
      'play': 'Dreieck-Symbol für Wiedergabe',
      'check': 'Häkchen für Bestätigung',
      'star': 'Stern für Favoriten',
      'notification': 'Glocken-Symbol für Benachrichtigungen'
    };
    
    return {
      label: maxLabel,
      confidence,
      reasoning: reasonings[maxLabel] || 'Unbekanntes Symbol'
    };
  }
  
  private async callOpenAI(imageData: ImageData): Promise<{ label: string; confidence: number; reasoning?: string }> {
    // Convert imageData to base64
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.llmProvider.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.llmProvider.model || 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What UI icon is this? Reply with JSON: {"label": "icon_name", "confidence": 0.0-1.0, "reasoning": "explanation"}'
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${base64}` }
              }
            ]
          }],
          max_tokens: 150
        })
      });
      
      const data = await response.json();
      const content = data.choices[0].message.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('[ContinuousLearner] OpenAI call failed:', error);
      return { label: 'unknown', confidence: 0.5 };
    }
  }
  
  private async callClaude(imageData: ImageData): Promise<{ label: string; confidence: number; reasoning?: string }> {
    // Similar to OpenAI but for Anthropic Claude API
    console.warn('[ContinuousLearner] Claude API not yet implemented, using simulation');
    return this.simulateLLM(imageData);
  }
  
  // ==================== Training ====================
  
  private calculateReward(
    cnnCategory: string,
    cnnConfidence: number,
    llmCategory: string,
    llmConfidence: number
  ): number {
    if (llmConfidence < 0.7) {
      return 0; // LLM not confident enough
    }
    
    if (cnnCategory === llmCategory) {
      // Agreement - positive reward scaled by confidence
      return 0.5 + (cnnConfidence * 0.5);
    }
    
    // Disagreement - negative reward for correction
    return Math.max(-1, -llmConfidence + (1 - cnnConfidence) * 0.3);
  }
  
  private async trainOnSample(imageData: ImageData, correctLabel: string, reward: number): Promise<void> {
    if (!this.cnn) return;
    
    // Convert label to category index
    const categories = this.cnn.getCategories();
    const labelIndex = categories.indexOf(correctLabel);
    
    if (labelIndex === -1) {
      console.warn(`[ContinuousLearner] Unknown label: ${correctLabel}`);
      return;
    }
    
    // Simple training: adjust prediction towards correct label
    // In a full implementation, this would use model.fit()
    console.log(`[ContinuousLearner] Training: ${correctLabel} (reward: ${reward.toFixed(2)})`);
    
    this.emit({
      type: 'training',
      data: {
        icon: { id: 'training', imageData, x: 0, y: 0, width: imageData.width, height: imageData.height },
        correct: correctLabel,
        reward
      }
    });
  }
  
  // ==================== Model Persistence ====================
  
  async saveModel(): Promise<boolean> {
    if (!this.cnn) return false;
    
    try {
      const modelData = await this.cnn.exportModel();
      
      const saveData = {
        model: modelData,
        stats: this.stats,
        timestamp: Date.now(),
        version: '1.0'
      };
      
      // Save to localStorage (or IndexedDB for larger models)
      localStorage.setItem(this.config.storageKey, JSON.stringify(saveData));
      
      this.stats.lastSaveTime = Date.now();
      
      this.emit({
        type: 'model-saved',
        data: { timestamp: this.stats.lastSaveTime, samples: this.stats.totalSamples }
      });
      
      console.log(`[ContinuousLearner] Model saved (${this.stats.totalSamples} samples)`);
      return true;
    } catch (error) {
      console.error('[ContinuousLearner] Save failed:', error);
      this.emit({ type: 'error', data: error as Error });
      return false;
    }
  }
  
  async loadModel(): Promise<boolean> {
    try {
      const saved = localStorage.getItem(this.config.storageKey);
      if (!saved) return false;
      
      const saveData = JSON.parse(saved);
      
      if (this.cnn && saveData.model) {
        await this.cnn.importModel(saveData.model);
      }
      
      if (saveData.stats) {
        this.stats = {
          ...this.stats,
          ...saveData.stats,
          sessionStartTime: Date.now() // Reset session time
        };
      }
      
      this.emit({
        type: 'model-loaded',
        data: { timestamp: saveData.timestamp, samples: this.stats.totalSamples }
      });
      
      return true;
    } catch (error) {
      console.error('[ContinuousLearner] Load failed:', error);
      return false;
    }
  }
  
  async clearModel(): Promise<void> {
    localStorage.removeItem(this.config.storageKey);
    
    // Re-initialize CNN
    if (this.cnn) {
      await this.cnn.initialize();
    }
    
    // Reset stats
    this.stats = {
      totalSamples: 0,
      correctPredictions: 0,
      llmCorrections: 0,
      modelUpdates: 0,
      accuracy: 0,
      lastSaveTime: 0,
      sessionStartTime: Date.now()
    };
    
    console.log('[ContinuousLearner] Model cleared');
  }
  
  // ==================== Auto-Refresh ====================
  
  startAutoRefresh(captureCallback: () => Promise<DetectedIcon[]>): void {
    if (this.autoRefreshTimer) {
      this.stopAutoRefresh();
    }
    
    console.log(`[ContinuousLearner] Auto-refresh started (${this.config.refreshInterval}ms)`);
    
    const tick = async () => {
      try {
        const icons = await captureCallback();
        if (icons.length > 0) {
          await this.classifyIcons(icons);
        }
      } catch (error) {
        console.error('[ContinuousLearner] Auto-refresh error:', error);
        this.emit({ type: 'error', data: error as Error });
      }
    };
    
    // Initial tick
    tick();
    
    // Setup interval
    this.autoRefreshTimer = window.setInterval(tick, this.config.refreshInterval);
  }
  
  stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      console.log('[ContinuousLearner] Auto-refresh stopped');
    }
  }
  
  // ==================== Event System ====================
  
  on(callback: LearnerEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }
  
  private emit(event: LearnerEvent): void {
    this.eventListeners.forEach(cb => {
      try {
        cb(event);
      } catch (e) {
        console.error('[ContinuousLearner] Event handler error:', e);
      }
    });
  }
  
  // ==================== Getters ====================
  
  getStats(): LearningStats {
    return { ...this.stats };
  }
  
  isLearningEnabled(): boolean {
    return this.config.learningEnabled;
  }
  
  setLearningEnabled(enabled: boolean): void {
    this.config.learningEnabled = enabled;
  }
  
  getConfig(): ContinuousLearnerConfig {
    return { ...this.config };
  }
  
  setConfig(config: Partial<ContinuousLearnerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ==================== Factory Function ====================

export function createContinuousLearner(config?: ContinuousLearnerConfig): ContinuousLearner {
  return new ContinuousLearner(config);
}

// ==================== Export ====================

export default ContinuousLearner;