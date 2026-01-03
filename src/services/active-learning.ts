/**
 * Active Learning Pipeline - Dataset-Aufbau für UI-Klassifizierung
 * 
 * Features:
 * - CropService: Extrahiert einzelne UI-Elemente aus Screenshots
 * - DatasetManager: Organisiert validierte Trainingsbilder
 * - Uncertainty Queue: Elemente mit niedriger Confidence für LLM-Review
 * - Manifest: Statistiken über gesammelten Dataset
 * - Dynamic Categories: Kategorien werden aus CategoryRegistry geladen
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { loadCategoriesFromRegistry, getCategoryRegistry, reloadCategories as reloadCategoryRegistry } from './cnn-service';

// Jimp import for image manipulation
let Jimp: any = null;
try {
  Jimp = require('jimp');
} catch {
  Jimp = null;
}

// Static fallback categories (used if registry not available)
const FALLBACK_UI_CATEGORIES = [
  'button', 'icon', 'input', 'text', 'image',
  'checkbox', 'radio', 'dropdown', 'link',
  'container', 'header', 'footer', 'menu', 'toolbar', 'unknown'
];

// Dynamic category cache
let dynamicCategories: string[] | null = null;
let categoriesLoadedAt: number = 0;
const CATEGORY_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get current UI categories (from registry or fallback)
 */
function getUICategories(): string[] {
  const now = Date.now();
  
  // Return cached if fresh
  if (dynamicCategories && (now - categoriesLoadedAt) < CATEGORY_CACHE_MS) {
    return dynamicCategories;
  }
  
  try {
    dynamicCategories = loadCategoriesFromRegistry();
    categoriesLoadedAt = now;
    console.log(`[ActiveLearning] Loaded ${dynamicCategories.length} categories from registry`);
    return dynamicCategories;
  } catch (error) {
    console.warn('[ActiveLearning] Failed to load registry, using fallback categories');
    return FALLBACK_UI_CATEGORIES;
  }
}

/**
 * Force reload categories from registry
 */
export function reloadCategories(): string[] {
  dynamicCategories = null;
  categoriesLoadedAt = 0;
  reloadCategoryRegistry();
  return getUICategories();
}

/**
 * Check if a category is valid (exists in registry)
 */
export function isValidCategory(category: string): boolean {
  const categories = getUICategories();
  return categories.includes(category);
}

// ==================== Types ====================

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

export interface CropResult {
  boxId: string;
  category: string;
  confidence: number;
  cropPath: string;
  width: number;
  height: number;
  text?: string;
  timestamp: number;
}

export interface UncertainElement {
  boxId: string;
  suggestedCategory: string;
  confidence: number;
  cropPath: string;
  text?: string;
  timestamp: number;
  reviewed: boolean;
  finalCategory?: string;
}

export interface DatasetManifest {
  version: string;
  created: number;
  lastUpdated: number;
  totalSamples: number;
  categories: { [category: string]: number };
  uncertainCount: number;
  reviewedCount: number;
}

export interface ActiveLearningConfig {
  baseDir: string;
  cropDir: string;
  trainingDir: string;
  uncertainDir: string;
  highConfidenceThreshold: number;  // >= this auto-save
  lowConfidenceThreshold: number;   // < this skip
  cropPadding: number;
  maxCropSize: number;
  minCropSize: number;
}

const DEFAULT_CONFIG: ActiveLearningConfig = {
  baseDir: './detection_results',
  cropDir: './detection_results/crops',
  trainingDir: './training_data',
  uncertainDir: './detection_results/uncertain',
  highConfidenceThreshold: 0.8,
  lowConfidenceThreshold: 0.3,
  cropPadding: 2,
  maxCropSize: 256,
  minCropSize: 16
};

// ==================== Crop Service ====================

export class CropService extends EventEmitter {
  private config: ActiveLearningConfig;

  constructor(config: Partial<ActiveLearningConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extrahiert alle Boxes als einzelne Crop-Bilder
   */
  async cropBoxes(
    boxes: DetectionBox[],
    screenshotSource: string | Buffer
  ): Promise<CropResult[]> {
    if (!Jimp) {
      console.error('[CropService] Jimp not available');
      return [];
    }

    const image = await this.loadImage(screenshotSource);
    if (!image) {
      console.error('[CropService] Failed to load screenshot');
      return [];
    }

    // Ensure crop directory exists
    if (!fs.existsSync(this.config.cropDir)) {
      fs.mkdirSync(this.config.cropDir, { recursive: true });
    }

    const results: CropResult[] = [];
    const timestamp = Date.now();

    for (const box of boxes) {
      try {
        const crop = await this.cropBox(image, box, timestamp);
        if (crop) {
          results.push(crop);
        }
      } catch (error) {
        console.error(`[CropService] Failed to crop box ${box.id}:`, error);
      }
    }

    console.log(`[CropService] Cropped ${results.length}/${boxes.length} boxes`);
    this.emit('crops_complete', { total: results.length });

    return results;
  }

  /**
   * Extrahiert eine einzelne Box
   */
  private async cropBox(
    image: any,
    box: DetectionBox,
    timestamp: number
  ): Promise<CropResult | null> {
    const { cropPadding, maxCropSize, minCropSize } = this.config;

    // Calculate crop bounds with padding
    const x = Math.max(0, box.x - cropPadding);
    const y = Math.max(0, box.y - cropPadding);
    const width = Math.min(image.getWidth() - x, box.width + cropPadding * 2);
    const height = Math.min(image.getHeight() - y, box.height + cropPadding * 2);

    // Skip too small or too large
    if (width < minCropSize || height < minCropSize) {
      return null;
    }

    try {
      let cropped = image.clone().crop(x, y, width, height);

      // Resize if too large
      if (cropped.getWidth() > maxCropSize || cropped.getHeight() > maxCropSize) {
        cropped = cropped.scaleToFit(maxCropSize, maxCropSize);
      }

      // Generate filename
      const category = box.category || 'unknown';
      const filename = `${category}_${box.id}_${timestamp}.png`;
      const cropPath = path.join(this.config.cropDir, filename);

      // Save crop
      await cropped.writeAsync(cropPath);

      return {
        boxId: box.id,
        category,
        confidence: box.confidence || 0,
        cropPath,
        width: cropped.getWidth(),
        height: cropped.getHeight(),
        text: box.text,
        timestamp
      };
    } catch (error) {
      console.error(`[CropService] Crop failed for ${box.id}:`, error);
      return null;
    }
  }

  private async loadImage(source: string | Buffer): Promise<any | null> {
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
      console.error('[CropService] Image load failed:', error);
      return null;
    }
  }
}

// ==================== Dataset Manager ====================

export class DatasetManager extends EventEmitter {
  private config: ActiveLearningConfig;
  private manifest: DatasetManifest;
  private manifestPath: string;
  private uncertainQueue: UncertainElement[] = [];
  private knownCategories: Set<string> = new Set();

  constructor(config: Partial<ActiveLearningConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.manifestPath = path.join(this.config.trainingDir, 'manifest.json');
    this.manifest = this.loadOrCreateManifest();
    this.ensureDirectories();
  }

  /**
   * Reload categories and sync directories
   */
  reloadCategories(): void {
    const categories = reloadCategories();
    this.ensureDirectories();
    console.log(`[DatasetManager] Reloaded ${categories.length} categories`);
    this.emit('categories_reloaded', { categories });
  }

  /**
   * Get current valid categories
   */
  getValidCategories(): string[] {
    return getUICategories();
  }

  /**
   * Verarbeitet Crop-Ergebnisse und sortiert nach Confidence
   */
  async processCrops(crops: CropResult[]): Promise<{
    saved: number;
    queued: number;
    skipped: number;
  }> {
    let saved = 0;
    let queued = 0;
    let skipped = 0;

    for (const crop of crops) {
      if (crop.confidence >= this.config.highConfidenceThreshold) {
        // High confidence - auto-save to training data
        const success = await this.saveToTrainingData(crop);
        if (success) saved++;
      } else if (crop.confidence >= this.config.lowConfidenceThreshold) {
        // Medium confidence - queue for review
        this.addToUncertainQueue(crop);
        queued++;
      } else {
        // Low confidence - skip
        skipped++;
      }
    }

    // Save manifest
    this.saveManifest();

    console.log(`[DatasetManager] Processed ${crops.length} crops: ${saved} saved, ${queued} queued, ${skipped} skipped`);
    this.emit('processing_complete', { saved, queued, skipped });

    return { saved, queued, skipped };
  }

  /**
   * Speichert Crop im Training-Dataset
   */
  async saveToTrainingData(crop: CropResult, overrideCategory?: string): Promise<boolean> {
    const category = overrideCategory || crop.category;
    const validCategories = getUICategories();
    
    // Check if category is valid
    if (!validCategories.includes(category)) {
      // Try to add unknown category to manifest anyway
      console.warn(`[DatasetManager] Category '${category}' not in registry, saving as 'unknown'`);
      return this.saveToTrainingData(crop, 'unknown');
    }

    const categoryDir = path.join(this.config.trainingDir, category);
    
    // Ensure category directory exists (for dynamic categories)
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
      this.knownCategories.add(category);
    }

    try {
      // Copy crop to training directory
      const filename = path.basename(crop.cropPath);
      const destPath = path.join(categoryDir, filename);
      
      fs.copyFileSync(crop.cropPath, destPath);

      // Update manifest with category (may be new)
      this.manifest.categories[category] = (this.manifest.categories[category] || 0) + 1;
      this.manifest.totalSamples++;
      this.manifest.lastUpdated = Date.now();

      // Save metadata
      const metaPath = path.join(categoryDir, 'labels.jsonl');
      const meta = {
        file: filename,
        category,
        confidence: crop.confidence,
        text: crop.text,
        width: crop.width,
        height: crop.height,
        timestamp: crop.timestamp,
        categorySource: validCategories.includes(category) ? 'registry' : 'dynamic'
      };
      fs.appendFileSync(metaPath, JSON.stringify(meta) + '\n');

      return true;
    } catch (error) {
      console.error(`[DatasetManager] Failed to save ${crop.boxId}:`, error);
      return false;
    }
  }

  /**
   * Fügt Element zur Unsicherheits-Queue hinzu
   */
  addToUncertainQueue(crop: CropResult): void {
    const uncertain: UncertainElement = {
      boxId: crop.boxId,
      suggestedCategory: crop.category,
      confidence: crop.confidence,
      cropPath: crop.cropPath,
      text: crop.text,
      timestamp: crop.timestamp,
      reviewed: false
    };

    this.uncertainQueue.push(uncertain);
    this.manifest.uncertainCount++;

    // Copy to uncertain directory
    const uncertainDir = this.config.uncertainDir;
    if (!fs.existsSync(uncertainDir)) {
      fs.mkdirSync(uncertainDir, { recursive: true });
    }

    const filename = path.basename(crop.cropPath);
    const destPath = path.join(uncertainDir, filename);
    
    try {
      fs.copyFileSync(crop.cropPath, destPath);
      uncertain.cropPath = destPath;
    } catch (error) {
      console.error(`[DatasetManager] Failed to queue ${crop.boxId}:`, error);
    }

    // Save queue state
    this.saveUncertainQueue();
  }

  /**
   * Markiert ein unsicheres Element als reviewed und speichert es
   */
  async reviewUncertainElement(
    boxId: string,
    finalCategory: string,
    isCorrect: boolean
  ): Promise<boolean> {
    const index = this.uncertainQueue.findIndex(u => u.boxId === boxId);
    if (index === -1) {
      console.warn(`[DatasetManager] Element ${boxId} not in queue`);
      return false;
    }

    const element = this.uncertainQueue[index];
    element.reviewed = true;
    element.finalCategory = finalCategory;

    if (isCorrect || finalCategory !== element.suggestedCategory) {
      // Save with corrected/confirmed category
      const crop: CropResult = {
        boxId: element.boxId,
        category: finalCategory,
        confidence: 1.0,  // Human-verified
        cropPath: element.cropPath,
        width: 0,
        height: 0,
        text: element.text,
        timestamp: element.timestamp
      };

      await this.saveToTrainingData(crop, finalCategory);
    }

    // Remove from queue
    this.uncertainQueue.splice(index, 1);
    this.manifest.reviewedCount++;
    this.manifest.uncertainCount--;

    this.saveManifest();
    this.saveUncertainQueue();

    return true;
  }

  /**
   * Gibt unsichare Elemente für Review zurück
   */
  getUncertainElements(limit: number = 10): UncertainElement[] {
    return this.uncertainQueue
      .filter(u => !u.reviewed)
      .slice(0, limit);
  }

  /**
   * Gibt Dataset-Statistiken zurück
   */
  getManifest(): DatasetManifest {
    return { ...this.manifest };
  }

  /**
   * Gibt Anzahl pro Kategorie zurück
   */
  getCategoryDistribution(): { [category: string]: number } {
    return { ...this.manifest.categories };
  }

  // ==================== Private Methods ====================

  private ensureDirectories(): void {
    const dirs = [
      this.config.trainingDir,
      this.config.cropDir,
      this.config.uncertainDir
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Create category subdirectories from dynamic list
    const categories = getUICategories();
    for (const category of categories) {
      const catDir = path.join(this.config.trainingDir, category);
      if (!fs.existsSync(catDir)) {
        fs.mkdirSync(catDir, { recursive: true });
      }
      this.knownCategories.add(category);
    }
  }

  private loadOrCreateManifest(): DatasetManifest {
    if (fs.existsSync(this.manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
        
        // Sync with current categories
        const currentCategories = getUICategories();
        for (const cat of currentCategories) {
          if (!(cat in manifest.categories)) {
            manifest.categories[cat] = 0;
          }
        }
        
        return manifest;
      } catch {
        console.warn('[DatasetManager] Failed to load manifest, creating new');
      }
    }

    const manifest: DatasetManifest = {
      version: '1.1.0',  // Updated version for dynamic categories
      created: Date.now(),
      lastUpdated: Date.now(),
      totalSamples: 0,
      categories: {},
      uncertainCount: 0,
      reviewedCount: 0
    };

    // Initialize category counts from dynamic list
    const categories = getUICategories();
    for (const cat of categories) {
      manifest.categories[cat] = 0;
    }

    return manifest;
  }

  private saveManifest(): void {
    try {
      fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
    } catch (error) {
      console.error('[DatasetManager] Failed to save manifest:', error);
    }
  }

  private saveUncertainQueue(): void {
    const queuePath = path.join(this.config.uncertainDir, 'queue.json');
    try {
      fs.writeFileSync(queuePath, JSON.stringify(this.uncertainQueue, null, 2));
    } catch (error) {
      console.error('[DatasetManager] Failed to save queue:', error);
    }
  }
}

// ==================== Active Learning Pipeline ====================

export class ActiveLearningPipeline extends EventEmitter {
  private cropService: CropService;
  private datasetManager: DatasetManager;
  private config: ActiveLearningConfig;

  constructor(config: Partial<ActiveLearningConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cropService = new CropService(this.config);
    this.datasetManager = new DatasetManager(this.config);

    // Forward events
    this.cropService.on('crops_complete', (data) => this.emit('crops_complete', data));
    this.datasetManager.on('processing_complete', (data) => this.emit('processing_complete', data));
    this.datasetManager.on('categories_reloaded', (data) => this.emit('categories_reloaded', data));
  }

  /**
   * Reload categories from registry
   */
  reloadCategories(): void {
    this.datasetManager.reloadCategories();
    console.log('[ActiveLearning] Categories reloaded');
  }

  /**
   * Get current valid categories
   */
  getValidCategories(): string[] {
    return this.datasetManager.getValidCategories();
  }

  /**
   * Check if category is valid
   */
  isValidCategory(category: string): boolean {
    return isValidCategory(category);
  }

  /**
   * Vollständiger Pipeline-Durchlauf
   */
  async process(
    boxes: DetectionBox[],
    screenshotSource: string | Buffer
  ): Promise<{
    totalBoxes: number;
    cropped: number;
    saved: number;
    queued: number;
    skipped: number;
  }> {
    console.log(`[ActiveLearning] Processing ${boxes.length} boxes...`);

    // Step 1: Crop all boxes
    const crops = await this.cropService.cropBoxes(boxes, screenshotSource);

    // Step 2: Process and sort by confidence
    const result = await this.datasetManager.processCrops(crops);

    console.log(`[ActiveLearning] Complete: ${result.saved} saved, ${result.queued} for review`);

    this.emit('pipeline_complete', {
      totalBoxes: boxes.length,
      cropped: crops.length,
      ...result
    });

    return {
      totalBoxes: boxes.length,
      cropped: crops.length,
      ...result
    };
  }

  /**
   * Gibt unsichere Elemente für Review
   */
  getUncertainElements(limit?: number): UncertainElement[] {
    return this.datasetManager.getUncertainElements(limit);
  }

  /**
   * Alias für getUncertainElements (Kompatibilität mit MoireServer)
   */
  getUncertainQueue(limit?: number): UncertainElement[] {
    return this.getUncertainElements(limit);
  }

  /**
   * Gibt Anzahl der Elemente in der Queue
   */
  getQueueSize(): number {
    return this.datasetManager.getUncertainElements(Infinity).length;
  }

  /**
   * Reviewed ein unsicheres Element
   */
  async reviewElement(
    boxId: string,
    finalCategory: string,
    isCorrect: boolean = true
  ): Promise<boolean> {
    return this.datasetManager.reviewUncertainElement(boxId, finalCategory, isCorrect);
  }

  /**
   * Validiert und speichert ein Element mit korrigierter Kategorie
   */
  async validateAndSave(
    boxId: string,
    correctedCategory: string,
    validatorId?: string
  ): Promise<boolean> {
    console.log(`[ActiveLearning] Validating ${boxId} as '${correctedCategory}' by ${validatorId || 'unknown'}`);
    return this.datasetManager.reviewUncertainElement(boxId, correctedCategory, true);
  }

  /**
   * Gibt Dataset-Statistiken
   */
  getStats(): DatasetManifest {
    return this.datasetManager.getManifest();
  }

  /**
   * Get category statistics with registry info
   */
  getCategoryStats(): {
    distribution: { [category: string]: number };
    registryCategories: number;
    usedCategories: number;
    emptyCategories: string[];
  } {
    const distribution = this.datasetManager.getCategoryDistribution();
    const validCategories = getUICategories();
    const usedCategories = Object.entries(distribution).filter(([_, count]) => count > 0);
    const emptyCategories = validCategories.filter(cat => !distribution[cat] || distribution[cat] === 0);
    
    return {
      distribution,
      registryCategories: validCategories.length,
      usedCategories: usedCategories.length,
      emptyCategories
    };
  }

  /**
   * Alias für getStats (Kompatibilität mit MoireServer)
   */
  async getTrainingStats(): Promise<DatasetManifest> {
    return this.getStats();
  }

  /**
   * Gibt Kategorie-Verteilung
   */
  getCategoryDistribution(): { [category: string]: number } {
    return this.datasetManager.getCategoryDistribution();
  }

  /**
   * Exportiert Dataset in verschiedenen Formaten
   */
  async exportDataset(format: string = 'json'): Promise<string> {
    const stats = this.getStats();
    const distribution = this.getCategoryDistribution();
    const timestamp = Date.now();
    
    const exportDir = path.join(this.config.trainingDir, 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const exportPath = path.join(exportDir, `export_${timestamp}.${format}`);

    if (format === 'json') {
      // JSON Export mit Metadaten
      const exportData = {
        meta: {
          exported: new Date().toISOString(),
          format: 'json',
          version: '1.0.0'
        },
        stats,
        distribution,
        trainingDir: this.config.trainingDir,
        categories: Object.keys(distribution).filter(k => distribution[k] > 0)
      };
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
    } else if (format === 'csv') {
      // CSV Export für einfache Analyse
      const lines = ['category,count,percentage'];
      const total = stats.totalSamples || 1;
      
      for (const [category, count] of Object.entries(distribution)) {
        const percentage = ((count / total) * 100).toFixed(2);
        lines.push(`${category},${count},${percentage}%`);
      }
      
      fs.writeFileSync(exportPath, lines.join('\n'));
    } else if (format === 'tfrecord') {
      // TFRecord placeholder - würde TensorFlow.js benötigen
      console.log('[ActiveLearning] TFRecord export not yet implemented');
      fs.writeFileSync(exportPath.replace('.tfrecord', '.json'), JSON.stringify({
        error: 'TFRecord export not implemented',
        alternative: 'Use JSON format'
      }));
    }

    console.log(`[ActiveLearning] Dataset exported to: ${exportPath}`);
    return exportPath;
  }
}

// ==================== Singleton ====================

let pipelineInstance: ActiveLearningPipeline | null = null;

export function getActiveLearningPipeline(
  config?: Partial<ActiveLearningConfig>
): ActiveLearningPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new ActiveLearningPipeline(config);
  }
  return pipelineInstance;
}

export function resetActiveLearningPipeline(): void {
  pipelineInstance = null;
}

export default ActiveLearningPipeline;