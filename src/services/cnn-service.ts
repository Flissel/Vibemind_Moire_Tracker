/**
 * CNN Service - UI Element Classification
 * 
 * Features:
 * - TensorFlow.js für lokale Klassifizierung
 * - OpenAI Vision API als Fallback für komplexe Fälle
 * - Dynamische Kategorien aus CategoryRegistry (categories.json)
 * - Kategorisiert: button, icon, input, text, image, container, etc.
 * - Cross-platform (Win/Mac/Linux)
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// TensorFlow type definitions
interface TFTensor {
  data(): Promise<Float32Array>;
  dispose(): void;
  toFloat(): TFTensor;
  div(value: number): TFTensor;
  expandDims(axis: number): TFTensor;
}

interface TFModel {
  predict(input: TFTensor): TFTensor;
}

interface TFNode {
  decodeImage(buffer: Buffer, channels?: number): TFTensor;
}

interface TFBrowser {
  fromPixels(input: { data: Buffer; width: number; height: number }): TFTensor;
}

interface TFStatic {
  loadLayersModel(path: string): Promise<TFModel>;
  node?: TFNode;
  browser?: TFBrowser;
}

// OpenAI type definitions
interface OpenAIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;
}

interface OpenAIChatChoice {
  message: {
    content: string | null;
  };
}

interface OpenAIChatCompletion {
  choices: OpenAIChatChoice[];
}

interface OpenAIChatCompletionsAPI {
  create(params: {
    model: string;
    messages: OpenAIChatMessage[];
    max_tokens?: number;
    temperature?: number;
  }): Promise<OpenAIChatCompletion>;
}

interface OpenAIClient {
  chat: {
    completions: OpenAIChatCompletionsAPI;
  };
}

interface OpenAIConstructor {
  new (config: { apiKey: string; baseURL?: string; defaultHeaders?: Record<string, string> }): OpenAIClient;
}

// Jimp type definitions
interface JimpImage {
  getWidth(): number;
  getHeight(): number;
  clone(): JimpImage;
  crop(x: number, y: number, w: number, h: number): JimpImage;
  resize(w: number, h: number): JimpImage;
  scaleToFit(w: number, h: number): JimpImage;
  getBufferAsync(mime: string): Promise<Buffer>;
}

interface JimpStatic {
  read(source: string | Buffer): Promise<JimpImage>;
  MIME_PNG: string;
}

// Optional imports
let tf: TFStatic | null = null;
try {
  tf = require('@tensorflow/tfjs-node');
} catch {
  try {
    tf = require('@tensorflow/tfjs');
  } catch {
    tf = null;
  }
}

let OpenAI: OpenAIConstructor | null = null;
try {
  OpenAI = require('openai').default || require('openai');
} catch {
  OpenAI = null;
}

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

export interface ClassificationResult {
  boxId: string;
  category: string;
  confidence: number;
  allCategories?: { [key: string]: number };
}

export interface CNNConfig {
  modelPath?: string;
  useOpenAI: boolean;
  openaiApiKey?: string;
  openaiModel: string;
  categories: string[];
  minConfidence: number;
  batchSize: number;
}

// ===== Category Registry Integration =====

export interface CategoryDefinition {
  description: string;
  examples: string[];
  parent?: string;
  usageCount: number;
  createdBy?: string;
  createdAt?: string;
}

export interface CategoryRegistryData {
  categories: { [key: string]: CategoryDefinition };
  pending: { [key: string]: PendingCategory };
  settings: {
    autoApproveThreshold: number;
    promptCacheMinutes: number;
    maxCategories: number;
  };
  lastUpdated: string;
}

export interface PendingCategory {
  description: string;
  suggestedBy: string;
  votes: number;
  firstSuggestedAt: string;
  lastSuggestedAt: string;
  parent?: string;
  examples: string[];
}

// Path to categories.json registry
const CATEGORIES_REGISTRY_PATH = path.join(__dirname, '../../python/config/categories.json');
const CATEGORY_CACHE_MS = 5 * 60 * 1000; // 5 minutes cache

let categoriesCache: string[] | null = null;
let categoriesLoadedAt: number = 0;
let fullRegistryCache: CategoryRegistryData | null = null;

/**
 * Load categories from the CategoryRegistry JSON file
 */
export function loadCategoriesFromRegistry(): string[] {
  const now = Date.now();
  
  // Return cached if still valid
  if (categoriesCache && (now - categoriesLoadedAt) < CATEGORY_CACHE_MS) {
    return categoriesCache;
  }
  
  try {
    if (fs.existsSync(CATEGORIES_REGISTRY_PATH)) {
      const data = fs.readFileSync(CATEGORIES_REGISTRY_PATH, 'utf-8');
      const registry: CategoryRegistryData = JSON.parse(data);
      
      // Extract category names
      const categories = Object.keys(registry.categories);
      
      // Cache the results
      categoriesCache = categories;
      fullRegistryCache = registry;
      categoriesLoadedAt = now;
      
      console.log(`[CNN] Loaded ${categories.length} categories from registry`);
      return categories;
    }
  } catch (error) {
    console.warn('[CNN] Failed to load categories from registry:', error);
  }
  
  // Fallback to defaults
  console.log('[CNN] Using default categories');
  return DEFAULT_CATEGORIES;
}

/**
 * Get the full registry data
 */
export function getCategoryRegistry(): CategoryRegistryData | null {
  if (!fullRegistryCache) {
    loadCategoriesFromRegistry();
  }
  return fullRegistryCache;
}

/**
 * Get leaf categories (categories without children)
 */
export function getLeafCategories(): string[] {
  const registry = getCategoryRegistry();
  if (!registry) return loadCategoriesFromRegistry();
  
  const allCategories = Object.keys(registry.categories);
  const parents = new Set(
    Object.values(registry.categories)
      .filter(c => c.parent)
      .map(c => c.parent!)
  );
  
  return allCategories.filter(cat => !parents.has(cat));
}

/**
 * Get category hierarchy as a tree structure
 */
export function getCategoryHierarchy(): { [parent: string]: string[] } {
  const registry = getCategoryRegistry();
  if (!registry) return {};
  
  const hierarchy: { [parent: string]: string[] } = { root: [] };
  
  for (const [name, def] of Object.entries(registry.categories)) {
    const parent = def.parent || 'root';
    if (!hierarchy[parent]) {
      hierarchy[parent] = [];
    }
    hierarchy[parent].push(name);
  }
  
  return hierarchy;
}

/**
 * Force reload categories from registry
 */
export function reloadCategories(): string[] {
  categoriesCache = null;
  categoriesLoadedAt = 0;
  fullRegistryCache = null;
  return loadCategoriesFromRegistry();
}

// ===== End Category Registry Integration =====

const DEFAULT_CATEGORIES = [
  'button',
  'icon',
  'input',
  'text',
  'image',
  'checkbox',
  'radio',
  'dropdown',
  'link',
  'container',
  'header',
  'footer',
  'menu',
  'toolbar',
  'unknown'
];

const DEFAULT_CONFIG: CNNConfig = {
  useOpenAI: true,
  openaiModel: 'openai/gpt-4o-mini',  // OpenRouter model format
  categories: [], // Will be loaded dynamically
  minConfidence: 0.5,
  batchSize: 10
};

export class CNNClassifier extends EventEmitter {
  private config: CNNConfig;
  private model: TFModel | null = null;
  private openai: OpenAIClient | null = null;
  private isInitialized: boolean = false;
  private useLocalModel: boolean = false;
  private dynamicCategories: string[] = [];

  constructor(config: Partial<CNNConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Load dynamic categories if not provided
    if (!config.categories || config.categories.length === 0) {
      this.dynamicCategories = loadCategoriesFromRegistry();
      this.config.categories = this.dynamicCategories;
    }
  }

  /**
   * Reload categories from registry (call when categories change)
   */
  reloadCategories(): void {
    this.dynamicCategories = reloadCategories();
    this.config.categories = this.dynamicCategories;
    console.log(`[CNN] Reloaded ${this.dynamicCategories.length} categories`);
    this.emit('categories_reloaded', { categories: this.dynamicCategories });
  }

  /**
   * Get current categories
   */
  getCategories(): string[] {
    return this.config.categories;
  }

  /**
   * Check if a category is valid
   */
  isValidCategory(category: string): boolean {
    // Ensure categories are fresh
    if (Date.now() - categoriesLoadedAt > CATEGORY_CACHE_MS) {
      this.dynamicCategories = loadCategoriesFromRegistry();
      this.config.categories = this.dynamicCategories;
    }
    return this.config.categories.includes(category);
  }

  /**
   * Get category info from registry
   */
  getCategoryInfo(category: string): CategoryDefinition | null {
    const registry = getCategoryRegistry();
    if (!registry) return null;
    return registry.categories[category] || null;
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    // Ensure categories are loaded
    if (this.config.categories.length === 0) {
      this.config.categories = loadCategoriesFromRegistry();
    }

    // Try to load local TensorFlow model
    if (tf && this.config.modelPath) {
      try {
        const modelPath = this.config.modelPath;
        if (fs.existsSync(modelPath)) {
          this.model = await tf.loadLayersModel(`file://${modelPath}`);
          this.useLocalModel = true;
          console.log('[CNN] Local TensorFlow model loaded');
        }
      } catch (error) {
        console.warn('[CNN] Failed to load TensorFlow model:', error);
      }
    }

    // Initialize OpenAI/OpenRouter as fallback
    if (this.config.useOpenAI && OpenAI) {
      // Try OpenRouter first, then OpenAI
      const openRouterKey = this.config.openaiApiKey || process.env.OPENROUTER_API_KEY;
      const openAIKey = process.env.OPENAI_API_KEY;
      
      if (openRouterKey) {
        // Use OpenRouter
        this.openai = new OpenAI({ 
          apiKey: openRouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'https://github.com/moire-tracker',
            'X-Title': 'MoireTracker CNN'
          }
        });
        console.log('[CNN] OpenRouter Vision API configured');
      } else if (openAIKey) {
        // Fallback to OpenAI
        this.openai = new OpenAI({ apiKey: openAIKey });
        console.log('[CNN] OpenAI Vision API configured');
      }
    }

    this.isInitialized = this.useLocalModel || !!this.openai;

    if (this.isInitialized) {
      this.emit('initialized', { useLocalModel: this.useLocalModel, useOpenAI: !!this.openai });
    } else {
      console.warn('[CNN] No classification backend available');
    }

    return this.isInitialized;
  }

  /**
   * Classify all detection boxes
   */
  async classifyBoxes(
    boxes: DetectionBox[],
    screenshotSource: string | Buffer
  ): Promise<ClassificationResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (boxes.length === 0) return [];

    const results: ClassificationResult[] = [];
    const screenshot = await this.loadImage(screenshotSource);
    if (!screenshot) return [];

    console.log(`[CNN] Classifying ${boxes.length} boxes...`);
    this.emit('classification_start', { total: boxes.length });

    // Process in batches
    for (let i = 0; i < boxes.length; i += this.config.batchSize) {
      const batch = boxes.slice(i, i + this.config.batchSize);
      
      let batchResults: ClassificationResult[];
      
      if (this.useLocalModel) {
        batchResults = await this.classifyWithTensorFlow(batch, screenshot);
      } else if (this.openai) {
        batchResults = await this.classifyWithOpenAI(batch, screenshot);
      } else {
        // Fallback: rule-based heuristics
        batchResults = this.classifyWithHeuristics(batch);
      }

      results.push(...batchResults);

      this.emit('classification_progress', {
        processed: Math.min(i + this.config.batchSize, boxes.length),
        total: boxes.length
      });
    }

    console.log(`[CNN] Classification complete: ${results.length} results`);
    this.emit('classification_complete', { results });

    return results;
  }

  /**
   * TensorFlow.js local classification
   */
  private async classifyWithTensorFlow(
    boxes: DetectionBox[],
    screenshot: JimpImage
  ): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];

    for (const box of boxes) {
      try {
        const cropped = await this.cropAndPreprocess(screenshot, box);
        if (!cropped) continue;

        // Run inference
        const predictions = this.model!.predict(cropped);
        const values = await predictions.data();
        predictions.dispose();
        cropped.dispose();

        // Find best category
        let maxIdx = 0;
        let maxVal = values[0];
        const allCategories: { [key: string]: number } = {};

        for (let i = 0; i < values.length; i++) {
          allCategories[this.config.categories[i]] = values[i];
          if (values[i] > maxVal) {
            maxVal = values[i];
            maxIdx = i;
          }
        }

        results.push({
          boxId: box.id,
          category: this.config.categories[maxIdx] || 'unknown',
          confidence: maxVal,
          allCategories
        });
      } catch (error) {
        console.error(`[CNN] TF classification failed for box ${box.id}:`, error);
      }
    }

    return results;
  }

  /**
   * OpenAI Vision API classification
   */
  private async classifyWithOpenAI(
    boxes: DetectionBox[],
    screenshot: JimpImage
  ): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = [];

    // Create composite image with crop regions highlighted
    const croppedImages: { box: DetectionBox; dataUrl: string }[] = [];

    for (const box of boxes) {
      try {
        const cropped = screenshot.clone().crop(
          Math.max(0, box.x - 2),
          Math.max(0, box.y - 2),
          Math.min(screenshot.getWidth() - box.x + 2, box.width + 4),
          Math.min(screenshot.getHeight() - box.y + 2, box.height + 4)
        );
        
        // Resize to max 100x100 for API efficiency
        if (cropped.getWidth() > 100 || cropped.getHeight() > 100) {
          cropped.scaleToFit(100, 100);
        }

        const buffer = await cropped.getBufferAsync(Jimp!.MIME_PNG);
        const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
        croppedImages.push({ box, dataUrl });
      } catch (error) {
        console.error(`[CNN] Crop failed for box ${box.id}:`, error);
      }
    }

    if (croppedImages.length === 0) return results;

    // Batch classify with OpenAI
    try {
      // Use dynamic categories from registry
      const currentCategories = this.config.categories.length > 0 
        ? this.config.categories 
        : loadCategoriesFromRegistry();
      
      const prompt = `Classify each UI element image into ONE category from: ${currentCategories.join(', ')}.

For each numbered image, respond with ONLY the category name, one per line.
Example response:
1. button
2. icon
3. input
...`;

      const imageContent = croppedImages.map((img) => ({
        type: 'image_url' as const,
        image_url: { url: img.dataUrl, detail: 'low' as const }
      }));

      const response = await this.openai!.chat.completions.create({
        model: this.config.openaiModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageContent
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.1
      });

      const responseText = response.choices[0].message.content || '';
      const lines = responseText.trim().split('\n');

      for (let i = 0; i < croppedImages.length; i++) {
        const line = lines[i] || '';
        const categoryMatch = line.match(/\d+\.\s*(\w+)/);
        const category = categoryMatch ? categoryMatch[1].toLowerCase() : 'unknown';
        
        // Validate category against dynamic list
        const validCategory = currentCategories.includes(category) ? category : 'unknown';

        results.push({
          boxId: croppedImages[i].box.id,
          category: validCategory,
          confidence: 0.8 // OpenAI doesn't provide confidence scores
        });
      }
    } catch (error) {
      console.error('[CNN] OpenAI classification failed:', error);
      // Fallback to heuristics
      return this.classifyWithHeuristics(boxes);
    }

    return results;
  }

  /**
   * Rule-based heuristic classification (fallback)
   */
  private classifyWithHeuristics(boxes: DetectionBox[]): ClassificationResult[] {
    return boxes.map(box => {
      let category = 'unknown';
      let confidence = 0.5;

      const aspectRatio = box.width / box.height;
      const area = box.width * box.height;
      const hasText = !!box.text;

      // Size-based heuristics
      if (area < 900) { // Small element
        if (aspectRatio > 0.8 && aspectRatio < 1.2) {
          category = 'icon';
          confidence = 0.7;
        } else if (aspectRatio > 2) {
          category = hasText ? 'button' : 'link';
          confidence = 0.6;
        }
      } else if (area < 5000) { // Medium element
        if (aspectRatio > 3) {
          category = hasText ? 'input' : 'text';
          confidence = 0.65;
        } else if (aspectRatio > 1.5 && aspectRatio < 4) {
          category = 'button';
          confidence = 0.6;
        } else {
          category = hasText ? 'text' : 'container';
          confidence = 0.5;
        }
      } else { // Large element
        if (box.y < 100) {
          category = 'header';
          confidence = 0.6;
        } else if (box.height > box.width) {
          category = 'menu';
          confidence = 0.5;
        } else {
          category = 'container';
          confidence = 0.5;
        }
      }

      // Text-based refinement
      if (hasText) {
        const text = box.text!.toLowerCase();
        if (text.length <= 3 && /^[^\w\s]/.test(text)) {
          category = 'icon';
        } else if (/^(ok|cancel|submit|save|delete|edit|close|back|next)/i.test(text)) {
          category = 'button';
          confidence = 0.8;
        } else if (/@|\.com|www\./i.test(text)) {
          category = 'link';
          confidence = 0.75;
        }
      }

      return {
        boxId: box.id,
        category,
        confidence
      };
    });
  }

  private async loadImage(source: string | Buffer): Promise<JimpImage | null> {
    if (!Jimp) return null;

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
      console.error('[CNN] Failed to load image:', error);
      return null;
    }
  }

  private async cropAndPreprocess(image: JimpImage, box: DetectionBox): Promise<TFTensor | null> {
    if (!tf) return null;

    try {
      const cropped = image.clone().crop(
        Math.max(0, box.x),
        Math.max(0, box.y),
        Math.min(image.getWidth() - box.x, box.width),
        Math.min(image.getHeight() - box.y, box.height)
      );

      // Resize to model input size (e.g., 64x64)
      cropped.resize(64, 64);

      // Convert to tensor
      const buffer = await cropped.getBufferAsync(Jimp!.MIME_PNG);
      const tensor = tf.node ? 
        tf.node.decodeImage(buffer, 3) :
        tf.browser!.fromPixels({ data: buffer, width: 64, height: 64 });

      // Normalize to [0, 1]
      return tensor.toFloat().div(255).expandDims(0);
    } catch (error) {
      console.error('[CNN] Preprocess failed:', error);
      return null;
    }
  }

  /**
   * Classify single box
   */
  async classifyBox(
    box: DetectionBox,
    screenshotSource: string | Buffer
  ): Promise<ClassificationResult | null> {
    const results = await this.classifyBoxes([box], screenshotSource);
    return results[0] || null;
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  getBackend(): string {
    if (this.useLocalModel) return 'tensorflow';
    if (this.openai) return 'openai';
    return 'heuristics';
  }

  /**
   * Get registry statistics
   */
  getRegistryStats(): { total: number; leaf: number; pending: number } {
    const registry = getCategoryRegistry();
    if (!registry) {
      return { total: this.config.categories.length, leaf: 0, pending: 0 };
    }
    
    const leafCategories = getLeafCategories();
    return {
      total: Object.keys(registry.categories).length,
      leaf: leafCategories.length,
      pending: Object.keys(registry.pending).length
    };
  }
}

// Singleton
let cnnInstance: CNNClassifier | null = null;

export function getCNNClassifier(config?: Partial<CNNConfig>): CNNClassifier {
  if (!cnnInstance) {
    cnnInstance = new CNNClassifier(config);
  }
  return cnnInstance;
}

export function resetCNNClassifier(): void {
  cnnInstance = null;
}

export default CNNClassifier;