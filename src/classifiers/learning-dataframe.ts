/**
 * Learning DataFrame
 * 
 * Speichert alle neu klassifizierten Icons für:
 * 1. Runtime-Erweiterung der Kategorien
 * 2. Export für nächstes Modell-Training
 * 3. Statistiken über erkannte Icon-Typen
 * 
 * Das DataFrame wächst kontinuierlich und kann exportiert werden
 * für offline-Training mit TensorFlow/PyTorch.
 */

// ==================== Base Categories ====================

export const BASE_ICON_CATEGORIES = [
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

export type BaseIconCategory = typeof BASE_ICON_CATEGORIES[number];

// ==================== Types ====================

export interface LearningRecord {
  /** Unique ID */
  id: string;
  /** Timestamp when recorded */
  timestamp: number;
  /** Icon image as base64 */
  imageBase64: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** CNN prediction */
  cnnPrediction: {
    label: string;
    confidence: number;
  };
  /** LLM label (if consulted) */
  llmLabel?: {
    label: string;
    confidence: number;
    reasoning?: string;
  };
  /** Final agreed label (human or auto) */
  finalLabel: string;
  /** Whether this was a new category */
  isNewCategory: boolean;
  /** Source context */
  source?: {
    app?: string;
    window?: string;
    screenPosition?: { x: number; y: number };
  };
  /** Training metadata */
  training?: {
    usedForTraining: boolean;
    reward?: number;
    epoch?: number;
  };
}

export interface CategoryStats {
  label: string;
  count: number;
  avgCnnConfidence: number;
  avgLlmConfidence: number;
  agreementRate: number;
  isCustom: boolean;
  firstSeen: number;
  lastSeen: number;
}

export interface DataFrameExport {
  version: string;
  exportedAt: number;
  totalRecords: number;
  categories: string[];
  customCategories: string[];
  records: LearningRecord[];
  stats: CategoryStats[];
}

// ==================== Learning DataFrame Class ====================

export class LearningDataFrame {
  private records: Map<string, LearningRecord> = new Map();
  private customCategories: Set<string> = new Set();
  private categoryStats: Map<string, CategoryStats> = new Map();
  private storageKey: string;
  private maxRecords: number;
  private autoSaveInterval: number;
  private autoSaveTimer: number | null = null;
  
  constructor(options: {
    storageKey?: string;
    maxRecords?: number;
    autoSaveInterval?: number;
  } = {}) {
    this.storageKey = options.storageKey || 'moire-learning-dataframe';
    this.maxRecords = options.maxRecords || 10000;
    this.autoSaveInterval = options.autoSaveInterval || 60000; // 1 minute
    
    // Initialize stats for base categories
    BASE_ICON_CATEGORIES.forEach(cat => {
      this.categoryStats.set(cat, this.createEmptyStats(cat, false));
    });
  }
  
  // ==================== Add Records ====================
  
  /**
   * Add a new learning record (called after each classification)
   */
  addRecord(record: Omit<LearningRecord, 'id' | 'timestamp' | 'isNewCategory'>): string {
    const id = this.generateId();
    const timestamp = Date.now();
    
    // Check if this is a new category
    const isNewCategory = !this.isKnownCategory(record.finalLabel);
    
    // Add to custom categories if new
    if (isNewCategory) {
      this.customCategories.add(record.finalLabel);
      this.categoryStats.set(record.finalLabel, this.createEmptyStats(record.finalLabel, true));
      console.log(`[LearningDataFrame] 🆕 Neue Kategorie entdeckt: "${record.finalLabel}"`);
    }
    
    const fullRecord: LearningRecord = {
      ...record,
      id,
      timestamp,
      isNewCategory
    };
    
    this.records.set(id, fullRecord);
    this.updateStats(fullRecord);
    
    // Enforce max records (FIFO)
    if (this.records.size > this.maxRecords) {
      const oldest = Array.from(this.records.keys())[0];
      this.records.delete(oldest);
    }
    
    return id;
  }
  
  /**
   * Quick add from detection result
   */
  addFromDetection(
    imageBase64: string,
    width: number,
    height: number,
    cnnLabel: string,
    cnnConfidence: number,
    llmLabel?: string,
    llmConfidence?: number,
    llmReasoning?: string
  ): string {
    // Determine final label (LLM preferred if confident)
    const finalLabel = (llmLabel && llmConfidence && llmConfidence > 0.7) 
      ? llmLabel 
      : cnnLabel;
    
    return this.addRecord({
      imageBase64,
      width,
      height,
      cnnPrediction: { label: cnnLabel, confidence: cnnConfidence },
      llmLabel: llmLabel ? { label: llmLabel, confidence: llmConfidence || 0, reasoning: llmReasoning } : undefined,
      finalLabel
    });
  }
  
  // ==================== Category Management ====================
  
  /**
   * Get all categories (base + custom)
   */
  getAllCategories(): string[] {
    return [...BASE_ICON_CATEGORIES, ...Array.from(this.customCategories)];
  }
  
  /**
   * Get only custom (new) categories
   */
  getCustomCategories(): string[] {
    return Array.from(this.customCategories);
  }
  
  /**
   * Check if category is known
   */
  isKnownCategory(label: string): boolean {
    return BASE_ICON_CATEGORIES.includes(label as BaseIconCategory) || 
           this.customCategories.has(label);
  }
  
  /**
   * Add custom category manually
   */
  addCustomCategory(label: string): void {
    if (!this.isKnownCategory(label)) {
      this.customCategories.add(label);
      this.categoryStats.set(label, this.createEmptyStats(label, true));
    }
  }
  
  // ==================== Statistics ====================
  
  private updateStats(record: LearningRecord): void {
    const stats = this.categoryStats.get(record.finalLabel);
    if (!stats) return;
    
    stats.count++;
    stats.lastSeen = record.timestamp;
    if (stats.firstSeen === 0) stats.firstSeen = record.timestamp;
    
    // Update averages
    const prevCount = stats.count - 1;
    stats.avgCnnConfidence = (stats.avgCnnConfidence * prevCount + record.cnnPrediction.confidence) / stats.count;
    
    if (record.llmLabel) {
      stats.avgLlmConfidence = (stats.avgLlmConfidence * prevCount + record.llmLabel.confidence) / stats.count;
      
      // Agreement rate
      const agreed = record.cnnPrediction.label === record.llmLabel.label;
      stats.agreementRate = (stats.agreementRate * prevCount + (agreed ? 1 : 0)) / stats.count;
    }
  }
  
  /**
   * Get statistics for all categories
   */
  getStats(): CategoryStats[] {
    return Array.from(this.categoryStats.values())
      .filter(s => s.count > 0)
      .sort((a, b) => b.count - a.count);
  }
  
  /**
   * Get statistics for a specific category
   */
  getCategoryStats(label: string): CategoryStats | undefined {
    return this.categoryStats.get(label);
  }
  
  // ==================== Query Records ====================
  
  /**
   * Get all records
   */
  getRecords(): LearningRecord[] {
    return Array.from(this.records.values());
  }
  
  /**
   * Get records by category
   */
  getRecordsByCategory(label: string): LearningRecord[] {
    return Array.from(this.records.values())
      .filter(r => r.finalLabel === label);
  }
  
  /**
   * Get records where CNN and LLM disagreed (good for review)
   */
  getDisagreements(): LearningRecord[] {
    return Array.from(this.records.values())
      .filter(r => r.llmLabel && r.cnnPrediction.label !== r.llmLabel.label);
  }
  
  /**
   * Get records with new categories
   */
  getNewCategoryRecords(): LearningRecord[] {
    return Array.from(this.records.values())
      .filter(r => r.isNewCategory);
  }
  
  /**
   * Get records not yet used for training
   */
  getUntrainedRecords(): LearningRecord[] {
    return Array.from(this.records.values())
      .filter(r => !r.training?.usedForTraining);
  }
  
  // ==================== Export ====================
  
  /**
   * Export complete DataFrame for offline training
   */
  export(): DataFrameExport {
    return {
      version: '1.0',
      exportedAt: Date.now(),
      totalRecords: this.records.size,
      categories: this.getAllCategories(),
      customCategories: this.getCustomCategories(),
      records: Array.from(this.records.values()),
      stats: this.getStats()
    };
  }
  
  /**
   * Export as CSV for easy review
   */
  exportCSV(): string {
    const headers = ['id', 'timestamp', 'finalLabel', 'cnnLabel', 'cnnConfidence', 'llmLabel', 'llmConfidence', 'isNewCategory', 'imageBase64'];
    
    const rows = Array.from(this.records.values()).map(r => [
      r.id,
      new Date(r.timestamp).toISOString(),
      r.finalLabel,
      r.cnnPrediction.label,
      r.cnnPrediction.confidence.toFixed(3),
      r.llmLabel?.label || '',
      (r.llmLabel?.confidence || 0).toFixed(3),
      r.isNewCategory ? 'true' : 'false',
      r.imageBase64.substring(0, 50) + '...' // Truncate for CSV
    ]);
    
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
  
  /**
   * Export for PyTorch/TensorFlow training
   * Returns JSON with image paths and labels
   */
  exportForTraining(): { images: string[]; labels: string[]; labelMap: Record<string, number> } {
    const categories = this.getAllCategories();
    const labelMap: Record<string, number> = {};
    categories.forEach((cat, idx) => labelMap[cat] = idx);
    
    const records = Array.from(this.records.values());
    
    return {
      images: records.map(r => r.imageBase64),
      labels: records.map(r => r.finalLabel),
      labelMap
    };
  }
  
  // ==================== Import ====================
  
  /**
   * Import DataFrame from export
   */
  import(data: DataFrameExport): void {
    // Add custom categories
    data.customCategories.forEach(cat => this.addCustomCategory(cat));
    
    // Add records
    data.records.forEach(r => {
      this.records.set(r.id, r);
      this.updateStats(r);
    });
    
    console.log(`[LearningDataFrame] Imported ${data.totalRecords} records, ${data.customCategories.length} custom categories`);
  }
  
  // ==================== Persistence ====================
  
  /**
   * Save to localStorage
   */
  save(): void {
    try {
      const data = this.export();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
        console.log(`[LearningDataFrame] Saved ${this.records.size} records`);
      }
    } catch (error) {
      console.error('[LearningDataFrame] Save failed:', error);
    }
  }
  
  /**
   * Load from localStorage
   */
  load(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return false;
      
      const data = JSON.parse(stored) as DataFrameExport;
      this.import(data);
      return true;
    } catch (error) {
      console.error('[LearningDataFrame] Load failed:', error);
      return false;
    }
  }
  
  /**
   * Clear all data
   */
  clear(): void {
    this.records.clear();
    this.customCategories.clear();
    
    // Reset stats
    this.categoryStats.clear();
    BASE_ICON_CATEGORIES.forEach(cat => {
      this.categoryStats.set(cat, this.createEmptyStats(cat, false));
    });
    
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
    
    console.log('[LearningDataFrame] Cleared');
  }
  
  /**
   * Start auto-save
   */
  startAutoSave(): void {
    if (this.autoSaveTimer) return;
    
    this.autoSaveTimer = setInterval(() => {
      this.save();
    }, this.autoSaveInterval) as unknown as number;
  }
  
  /**
   * Stop auto-save
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
  
  // ==================== Helpers ====================
  
  private generateId(): string {
    return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private createEmptyStats(label: string, isCustom: boolean): CategoryStats {
    return {
      label,
      count: 0,
      avgCnnConfidence: 0,
      avgLlmConfidence: 0,
      agreementRate: 0,
      isCustom,
      firstSeen: 0,
      lastSeen: 0
    };
  }
  
  // ==================== Summary ====================
  
  /**
   * Get summary for display
   */
  getSummary(): {
    totalRecords: number;
    totalCategories: number;
    customCategories: number;
    topCategories: { label: string; count: number }[];
    newCategoryRecords: number;
    disagreements: number;
    untrained: number;
  } {
    const stats = this.getStats();
    
    return {
      totalRecords: this.records.size,
      totalCategories: this.getAllCategories().length,
      customCategories: this.customCategories.size,
      topCategories: stats.slice(0, 10).map(s => ({ label: s.label, count: s.count })),
      newCategoryRecords: this.getNewCategoryRecords().length,
      disagreements: this.getDisagreements().length,
      untrained: this.getUntrainedRecords().length
    };
  }
}

// ==================== Factory ====================

export function createLearningDataFrame(options?: {
  storageKey?: string;
  maxRecords?: number;
  autoSaveInterval?: number;
}): LearningDataFrame {
  const df = new LearningDataFrame(options);
  df.load(); // Try to load existing data
  df.startAutoSave();
  return df;
}

// ==================== Export ====================

export default LearningDataFrame;