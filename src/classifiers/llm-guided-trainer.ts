/**
 * LLM-Guided CNN Trainer
 *
 * Reinforcement Learning from AI Feedback (RLAF)
 *
 * Workflow:
 * 1. CNN klassifiziert Icon → z.B. "share" (2%)
 * 2. LLM interpretiert Icon → z.B. "settings" (+ Reasoning)
 * 3. Vergleich: CNN falsch, LLM als Ground Truth
 * 4. Update CNN Weights mit LLM-Label
 * 5. Wiederhole bis Konvergenz
 */

import * as tf from '@tensorflow/tfjs';
import { ICON_CATEGORIES, IconCategory } from './cnn-icon-classifier';

// LLM Response Interface
export interface LLMIconInterpretation {
  category: IconCategory;
  confidence: number;
  reasoning: string;
  alternatives?: { category: IconCategory; probability: number }[];
}

// Training Sample aus LLM Feedback
export interface LLMTrainingSample {
  imageData: Uint8Array;
  width: number;
  height: number;
  cnnPrediction: IconCategory;
  cnnConfidence: number;
  llmLabel: IconCategory;
  llmConfidence: number;
  reward: number; // -1 bis +1
}

// LLM Provider Interface
export interface LLMProvider {
  analyzeIcon(imageBase64: string): Promise<LLMIconInterpretation>;
}

// Training Config
export interface LLMTrainerConfig {
  learningRate?: number;
  batchSize?: number;
  rewardThreshold?: number;   // Ab welcher Konfidenz-Differenz updaten
  minLLMConfidence?: number;  // Mindest-Konfidenz des LLM
  maxSamplesPerBatch?: number;
}

/**
 * LLM-Guided CNN Trainer
 *
 * Verwendet LLM-Interpretationen als "Teacher" für das CNN
 */
export class LLMGuidedTrainer {
  private model: tf.LayersModel | null = null;
  private config: Required<LLMTrainerConfig>;
  private trainingBuffer: LLMTrainingSample[] = [];
  private optimizer: tf.Optimizer;
  
  // Statistiken
  private stats = {
    totalSamples: 0,
    agreements: 0,
    disagreements: 0,
    updates: 0,
    avgReward: 0
  };

  constructor(config: LLMTrainerConfig = {}) {
    this.config = {
      learningRate: config.learningRate ?? 0.001,
      batchSize: config.batchSize ?? 8,
      rewardThreshold: config.rewardThreshold ?? 0.3,
      minLLMConfidence: config.minLLMConfidence ?? 0.7,
      maxSamplesPerBatch: config.maxSamplesPerBatch ?? 32
    };
    
    this.optimizer = tf.train.adam(this.config.learningRate);
  }

  /**
   * Verbinde mit bestehendem CNN Model
   */
  setModel(model: tf.LayersModel): void {
    this.model = model;
  }

  /**
   * Berechne Reward basierend auf CNN vs LLM
   * 
   * Reward Schema:
   * - CNN == LLM (beide confident): +1.0 (Verstärkung)
   * - CNN != LLM (LLM confident):   -1.0 bis 0 (Korrektur nötig)
   * - LLM unsicher: 0 (ignorieren)
   */
  calculateReward(
    cnnCategory: IconCategory,
    cnnConfidence: number,
    llmCategory: IconCategory,
    llmConfidence: number
  ): number {
    // LLM nicht confident genug → kein Update
    if (llmConfidence < this.config.minLLMConfidence) {
      return 0;
    }

    // Perfekte Übereinstimmung
    if (cnnCategory === llmCategory) {
      // Bonus basierend auf CNN Confidence
      return 0.5 + (cnnConfidence * 0.5); // 0.5 bis 1.0
    }

    // Nicht-Übereinstimmung → Penalty proportional zur LLM-Konfidenz
    const penalty = -llmConfidence;
    
    // Aber: Wenn CNN sehr unsicher war, weniger bestrafen
    const cnnUncertaintyBonus = (1 - cnnConfidence) * 0.3;
    
    return Math.max(-1, penalty + cnnUncertaintyBonus);
  }

  /**
   * Füge LLM-Feedback Sample hinzu
   */
  addFeedback(
    imageData: Uint8Array,
    width: number,
    height: number,
    cnnResult: { category: IconCategory; confidence: number },
    llmResult: LLMIconInterpretation
  ): LLMTrainingSample {
    const reward = this.calculateReward(
      cnnResult.category,
      cnnResult.confidence,
      llmResult.category,
      llmResult.confidence
    );

    const sample: LLMTrainingSample = {
      imageData: new Uint8Array(imageData),
      width,
      height,
      cnnPrediction: cnnResult.category,
      cnnConfidence: cnnResult.confidence,
      llmLabel: llmResult.category,
      llmConfidence: llmResult.confidence,
      reward
    };

    this.trainingBuffer.push(sample);
    this.updateStats(sample);

    // Buffer-Limit
    if (this.trainingBuffer.length > this.config.maxSamplesPerBatch * 4) {
      this.trainingBuffer = this.trainingBuffer.slice(-this.config.maxSamplesPerBatch * 2);
    }

    return sample;
  }

  /**
   * Statistiken aktualisieren
   */
  private updateStats(sample: LLMTrainingSample): void {
    this.stats.totalSamples++;
    
    if (sample.cnnPrediction === sample.llmLabel) {
      this.stats.agreements++;
    } else {
      this.stats.disagreements++;
    }
    
    // Running average für Reward
    const n = this.stats.totalSamples;
    this.stats.avgReward = ((n - 1) * this.stats.avgReward + sample.reward) / n;
  }

  /**
   * Training Step mit gesammelten Samples
   * 
   * Verwendet gewichtetes Cross-Entropy Loss:
   * - Positiver Reward → LLM-Label verstärken
   * - Negativer Reward → LLM-Label als Korrektur lernen
   */
  async trainStep(): Promise<{ loss: number; accuracy: number } | null> {
    if (!this.model) {
      throw new Error('Model nicht gesetzt. Rufe setModel() zuerst auf.');
    }

    // Filtere Samples mit signifikantem Reward
    const trainableSamples = this.trainingBuffer.filter(
      s => Math.abs(s.reward) >= this.config.rewardThreshold
    );

    if (trainableSamples.length < this.config.batchSize) {
      return null; // Nicht genug Samples
    }

    // Wähle Batch
    const batch = this.selectBatch(trainableSamples);
    
    // Konvertiere zu Tensoren
    const { xs, ys, weights } = this.prepareBatch(batch);

    try {
      // Gradient Descent mit gewichtetem Loss
      const result = await tf.tidy(() => {
        // Forward pass
        const predictions = (this.model! as tf.LayersModel).predict(xs) as tf.Tensor;
        
        // Gewichteter Cross-Entropy Loss
        const loss = tf.losses.softmaxCrossEntropy(ys, predictions, weights);
        
        // Accuracy
        const predClass = predictions.argMax(-1);
        const trueClass = ys.argMax(-1);
        const accuracy = predClass.equal(trueClass).mean();
        
        return {
          loss: loss.dataSync()[0],
          accuracy: accuracy.dataSync()[0]
        };
      });

      // Backpropagation
      await this.updateWeights(xs, ys, weights);
      
      this.stats.updates++;
      
      // Cleanup
      xs.dispose();
      ys.dispose();
      weights.dispose();

      // Entferne verwendete Samples
      this.trainingBuffer = this.trainingBuffer.filter(
        s => !batch.includes(s)
      );

      return result;
    } catch (error) {
      xs.dispose();
      ys.dispose();
      weights.dispose();
      throw error;
    }
  }

  /**
   * Wähle Trainings-Batch (priorisiere hohe |Reward|)
   */
  private selectBatch(samples: LLMTrainingSample[]): LLMTrainingSample[] {
    // Sortiere nach absolutem Reward (wichtigste zuerst)
    const sorted = [...samples].sort(
      (a, b) => Math.abs(b.reward) - Math.abs(a.reward)
    );
    
    return sorted.slice(0, this.config.batchSize);
  }

  /**
   * Konvertiere Samples zu Tensoren
   */
  private prepareBatch(batch: LLMTrainingSample[]): {
    xs: tf.Tensor4D;
    ys: tf.Tensor2D;
    weights: tf.Tensor1D;
  } {
    const images: number[][][][] = [];
    const labels: number[][] = [];
    const sampleWeights: number[] = [];

    for (const sample of batch) {
      // Bild zu 32x32x3 Tensor
      const imgTensor = this.imageDataToTensor(
        sample.imageData,
        sample.width,
        sample.height
      );
      images.push(imgTensor);

      // One-Hot Label (LLM-Label als Ground Truth)
      const labelIdx = ICON_CATEGORIES.indexOf(sample.llmLabel);
      const oneHot = new Array(ICON_CATEGORIES.length).fill(0);
      oneHot[labelIdx] = 1;
      labels.push(oneHot);

      // Sample Weight basierend auf |Reward|
      // Höherer Reward = wichtigeres Sample
      sampleWeights.push(Math.abs(sample.reward));
    }

    return {
      xs: tf.tensor4d(images),
      ys: tf.tensor2d(labels),
      weights: tf.tensor1d(sampleWeights)
    };
  }

  /**
   * ImageData zu normalisierten 32x32x3 Array
   */
  private imageDataToTensor(
    data: Uint8Array,
    width: number,
    height: number
  ): number[][][] {
    // Resize zu 32x32 (simplified)
    const targetSize = 32;
    const result: number[][][] = [];
    
    for (let y = 0; y < targetSize; y++) {
      const row: number[][] = [];
      for (let x = 0; x < targetSize; x++) {
        // Bilinear sampling
        const srcX = (x / targetSize) * width;
        const srcY = (y / targetSize) * height;
        const srcIdx = (Math.floor(srcY) * width + Math.floor(srcX)) * 4;
        
        // Normalisiere zu 0-1
        row.push([
          (data[srcIdx] || 0) / 255,
          (data[srcIdx + 1] || 0) / 255,
          (data[srcIdx + 2] || 0) / 255
        ]);
      }
      result.push(row);
    }
    
    return result;
  }

  /**
   * Gradient Update
   */
  private async updateWeights(
    xs: tf.Tensor4D,
    ys: tf.Tensor2D,
    weights: tf.Tensor1D
  ): Promise<void> {
    // Verwende model.fit für ein einzelnes Mini-Batch Update
    // Das ist stabiler als manuelle Gradient-Updates
    await (this.model as tf.LayersModel).fit(xs, ys, {
      epochs: 1,
      batchSize: xs.shape[0],
      sampleWeight: weights,
      verbose: 0
    });
  }

  /**
   * Hole aktuelle Statistiken
   */
  getStats(): typeof this.stats & { 
    agreementRate: number;
    bufferSize: number;
  } {
    const agreementRate = this.stats.totalSamples > 0
      ? this.stats.agreements / this.stats.totalSamples
      : 0;
    
    return {
      ...this.stats,
      agreementRate,
      bufferSize: this.trainingBuffer.length
    };
  }

  /**
   * Reset Trainer
   */
  reset(): void {
    this.trainingBuffer = [];
    this.stats = {
      totalSamples: 0,
      agreements: 0,
      disagreements: 0,
      updates: 0,
      avgReward: 0
    };
  }
}

/**
 * OpenAI/Anthropic LLM Provider (Beispiel)
 */
export class OpenAIIconAnalyzer implements LLMProvider {
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(config: { apiKey: string; model?: string; endpoint?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gpt-4-vision-preview';
    this.endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
  }

  async analyzeIcon(imageBase64: string): Promise<LLMIconInterpretation> {
    const prompt = `Analyze this icon image and classify it into one of these categories:
${ICON_CATEGORIES.join(', ')}

Respond in JSON format:
{
  "category": "category_name",
  "confidence": 0.0-1.0,
  "reasoning": "Why you chose this category",
  "alternatives": [{"category": "other", "probability": 0.1}]
}`;

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${imageBase64}` }
              }
            ]
          }
        ],
        max_tokens: 300
      })
    });

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    
    try {
      return JSON.parse(content);
    } catch {
      return {
        category: 'unknown',
        confidence: 0.1,
        reasoning: 'Failed to parse LLM response'
      };
    }
  }
}

/**
 * Anthropic Claude LLM Provider
 */
export class ClaudeIconAnalyzer implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'claude-3-sonnet-20240229';
  }

  async analyzeIcon(imageBase64: string): Promise<LLMIconInterpretation> {
    const prompt = `Analyze this icon and classify it. Categories: ${ICON_CATEGORIES.join(', ')}

Return JSON: {"category": "name", "confidence": 0.0-1.0, "reasoning": "explanation"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: imageBase64
                }
              },
              { type: 'text', text: prompt }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    const content = data.content[0]?.text || '{}';
    
    try {
      // Extrahiere JSON aus Response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {
        category: 'unknown',
        confidence: 0.1,
        reasoning: 'No JSON found'
      };
    } catch {
      return {
        category: 'unknown',
        confidence: 0.1,
        reasoning: 'Failed to parse Claude response'
      };
    }
  }
}

/**
 * OpenRouter LLM Provider
 *
 * Unterstützt alle Models via OpenRouter API:
 * - openai/gpt-4-vision-preview
 * - anthropic/claude-3-sonnet-20240229
 * - google/gemini-pro-vision
 * - etc.
 */
export class OpenRouterIconAnalyzer implements LLMProvider {
  private apiKey: string;
  private model: string;
  private siteUrl?: string;
  private siteName?: string;

  constructor(config: { 
    apiKey: string; 
    model?: string;
    siteUrl?: string;
    siteName?: string;
  }) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'openai/gpt-4o';
    this.siteUrl = config.siteUrl;
    this.siteName = config.siteName;
  }

  async analyzeIcon(imageBase64: string): Promise<LLMIconInterpretation> {
    const prompt = `Analyze this icon and classify it into one of these categories:
${ICON_CATEGORIES.join(', ')}

Return ONLY a JSON object (no markdown, no extra text):
{"category": "category_name", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.siteUrl || 'https://moire-canvas.local',
      'X-Title': this.siteName || 'Moire Canvas'
    };

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${imageBase64}` }
                }
              ]
            }
          ],
          max_tokens: 300,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[OpenRouter] API Error:', error);
        return {
          category: 'unknown',
          confidence: 0.1,
          reasoning: `API Error: ${response.status}`
        };
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || '{}';
      
      // Parse JSON from response (may be wrapped in markdown)
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          category: result.category || 'unknown',
          confidence: result.confidence || 0.5,
          reasoning: result.reasoning || 'No reasoning provided'
        };
      }
      
      return {
        category: 'unknown',
        confidence: 0.1,
        reasoning: 'Failed to parse response'
      };
    } catch (error) {
      console.error('[OpenRouter] Error:', error);
      return {
        category: 'unknown',
        confidence: 0.1,
        reasoning: `Error: ${error}`
      };
    }
  }

  /**
   * Batch analyze multiple icons (rate limited)
   */
  async analyzeIconBatch(images: string[], delayMs: number = 500): Promise<LLMIconInterpretation[]> {
    const results: LLMIconInterpretation[] = [];
    
    for (const img of images) {
      results.push(await this.analyzeIcon(img));
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return results;
  }

  /**
   * Get available models from OpenRouter
   */
  static async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await response.json();
      return data.data
        ?.filter((m: any) => m.context_length > 0)
        .map((m: any) => m.id) || [];
    } catch {
      return [];
    }
  }
}

/**
 * Automated Training Pipeline
 * 
 * Kombiniert Icon Erfassung → LLM Analyse → CNN Training
 */
export class AutoTrainingPipeline {
  private trainer: LLMGuidedTrainer;
  private llmProvider: LLMProvider;
  private isRunning = false;

  constructor(
    trainer: LLMGuidedTrainer,
    llmProvider: LLMProvider
  ) {
    this.trainer = trainer;
    this.llmProvider = llmProvider;
  }

  /**
   * Verarbeite einzelnes Icon
   */
  async processIcon(
    imageData: Uint8Array,
    width: number,
    height: number,
    cnnResult: { category: IconCategory; confidence: number }
  ): Promise<LLMTrainingSample | null> {
    // Konvertiere zu Base64
    const base64 = this.uint8ArrayToBase64(imageData);
    
    // LLM Analyse
    const llmResult = await this.llmProvider.analyzeIcon(base64);
    
    // Zum Training hinzufügen
    return this.trainer.addFeedback(
      imageData,
      width,
      height,
      cnnResult,
      llmResult
    );
  }

  /**
   * Starte kontinuierliches Training
   */
  async startContinuousTraining(
    intervalMs: number = 5000,
    onUpdate?: (stats: ReturnType<LLMGuidedTrainer['getStats']>) => void
  ): Promise<void> {
    this.isRunning = true;
    
    while (this.isRunning) {
      try {
        const result = await this.trainer.trainStep();
        
        if (result) {
          console.log(`[Training] Loss: ${result.loss.toFixed(4)}, Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
        }
        
        if (onUpdate) {
          onUpdate(this.trainer.getStats());
        }
      } catch (error) {
        console.error('[Training] Error:', error);
      }
      
      await this.sleep(intervalMs);
    }
  }

  /**
   * Stoppe Training
   */
  stop(): void {
    this.isRunning = false;
  }

  private uint8ArrayToBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}