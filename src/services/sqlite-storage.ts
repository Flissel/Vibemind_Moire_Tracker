/**
 * SQLite Storage Service for Icon Findings
 * 
 * Persists learned icon classifications for future reuse.
 */

import * as path from 'path';
import * as fs from 'fs';

// Type for icon category
export type IconCategory = 
  | 'sort' | 'filter' | 'user' | 'link' | 'menu' | 'unknown' | 'search' | 'message'
  | 'close' | 'stop' | 'copy' | 'paste' | 'pause' | 'play' | 'code' | 'warning' | 'info'
  | 'email' | 'folder' | 'file' | 'download' | 'upload' | 'save' | 'edit' | 'delete'
  | 'add' | 'remove' | 'back' | 'forward' | 'refresh' | 'home' | 'settings' | 'help'
  | 'lock' | 'unlock' | 'star' | 'heart' | 'share' | 'print' | 'camera' | 'microphone'
  | 'volume' | 'mute' | 'fullscreen' | 'minimize' | 'maximize' | 'notification' | 'calendar'
  | 'clock' | 'location' | 'arrow_up' | 'arrow_down' | 'arrow_left' | 'arrow_right'
  | 'check' | 'error_icon' | 'record' | 'attachment' | 'expand' | 'collapse';

export interface IconFinding {
  id?: number;
  phash: string;
  dhash?: string;
  category: IconCategory;
  confidence: number;
  source: 'manual' | 'llm' | 'cnn' | 'heuristic';
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface TextFinding {
  id?: number;
  text_hash: string;
  text: string;
  category: string;
  confidence: number;
  context?: Record<string, any>;
  created_at?: string;
}

// Simple JSON-based storage (fallback when better-sqlite3 not available)
export class SQLiteStorage {
  private dbPath: string;
  private iconFindings: Map<string, IconFinding> = new Map();
  private textFindings: Map<string, TextFinding> = new Map();
  private initialized = false;

  constructor(dbPath: string = './data/findings.json') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing data
    if (fs.existsSync(this.dbPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
        
        if (data.icons) {
          for (const [key, value] of Object.entries(data.icons)) {
            this.iconFindings.set(key, value as IconFinding);
          }
        }
        
        if (data.texts) {
          for (const [key, value] of Object.entries(data.texts)) {
            this.textFindings.set(key, value as TextFinding);
          }
        }
        
        console.log(`[SQLiteStorage] Loaded ${this.iconFindings.size} icons, ${this.textFindings.size} texts`);
      } catch (e) {
        console.warn('[SQLiteStorage] Failed to load existing data:', e);
      }
    }

    this.initialized = true;
  }

  private save(): void {
    const data = {
      icons: Object.fromEntries(this.iconFindings),
      texts: Object.fromEntries(this.textFindings),
      updated_at: new Date().toISOString()
    };
    
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  // ===================== Icon Operations =====================

  async saveIconFinding(finding: IconFinding): Promise<number> {
    await this.initialize();
    
    const existing = this.iconFindings.get(finding.phash);
    const id = existing?.id || this.iconFindings.size + 1;
    
    const record: IconFinding = {
      ...finding,
      id,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    this.iconFindings.set(finding.phash, record);
    this.save();
    
    return id;
  }

  async getIconByHash(phash: string): Promise<IconFinding | null> {
    await this.initialize();
    return this.iconFindings.get(phash) || null;
  }

  async findSimilarIcons(phash: string, maxDistance: number = 12): Promise<IconFinding[]> {
    await this.initialize();
    
    const results: IconFinding[] = [];
    
    for (const finding of this.iconFindings.values()) {
      const distance = this.hammingDistance(phash, finding.phash);
      if (distance <= maxDistance) {
        results.push(finding);
      }
    }
    
    return results.sort((a, b) => {
      const distA = this.hammingDistance(phash, a.phash);
      const distB = this.hammingDistance(phash, b.phash);
      return distA - distB;
    });
  }

  async getIconsByCategory(category: IconCategory): Promise<IconFinding[]> {
    await this.initialize();
    return Array.from(this.iconFindings.values()).filter(f => f.category === category);
  }

  async getAllIcons(): Promise<IconFinding[]> {
    await this.initialize();
    return Array.from(this.iconFindings.values());
  }

  async deleteIcon(phash: string): Promise<boolean> {
    await this.initialize();
    const deleted = this.iconFindings.delete(phash);
    if (deleted) this.save();
    return deleted;
  }

  // ===================== Text Operations =====================

  async saveTextFinding(finding: TextFinding): Promise<number> {
    await this.initialize();
    
    const existing = this.textFindings.get(finding.text_hash);
    const id = existing?.id || this.textFindings.size + 1;
    
    const record: TextFinding = {
      ...finding,
      id,
      created_at: existing?.created_at || new Date().toISOString()
    };
    
    this.textFindings.set(finding.text_hash, record);
    this.save();
    
    return id;
  }

  async getTextByHash(hash: string): Promise<TextFinding | null> {
    await this.initialize();
    return this.textFindings.get(hash) || null;
  }

  async getAllTexts(): Promise<TextFinding[]> {
    await this.initialize();
    return Array.from(this.textFindings.values());
  }

  // ===================== Stats =====================

  async getStats(): Promise<{
    totalIcons: number;
    totalTexts: number;
    iconsByCategory: Record<string, number>;
    iconsBySource: Record<string, number>;
  }> {
    await this.initialize();
    
    const iconsByCategory: Record<string, number> = {};
    const iconsBySource: Record<string, number> = {};
    
    for (const finding of this.iconFindings.values()) {
      iconsByCategory[finding.category] = (iconsByCategory[finding.category] || 0) + 1;
      iconsBySource[finding.source] = (iconsBySource[finding.source] || 0) + 1;
    }
    
    return {
      totalIcons: this.iconFindings.size,
      totalTexts: this.textFindings.size,
      iconsByCategory,
      iconsBySource
    };
  }

  // ===================== Export/Import =====================

  async exportToFile(filepath: string): Promise<void> {
    await this.initialize();
    
    const data = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      icons: Array.from(this.iconFindings.values()),
      texts: Array.from(this.textFindings.values())
    };
    
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  async importFromFile(filepath: string): Promise<{ icons: number; texts: number }> {
    await this.initialize();
    
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    let importedIcons = 0;
    let importedTexts = 0;
    
    if (data.icons) {
      for (const icon of data.icons) {
        if (!this.iconFindings.has(icon.phash)) {
          this.iconFindings.set(icon.phash, icon);
          importedIcons++;
        }
      }
    }
    
    if (data.texts) {
      for (const text of data.texts) {
        if (!this.textFindings.has(text.text_hash)) {
          this.textFindings.set(text.text_hash, text);
          importedTexts++;
        }
      }
    }
    
    this.save();
    return { icons: importedIcons, texts: importedTexts };
  }

  // ===================== Utility =====================

  private hammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      return Number.MAX_VALUE;
    }
    
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        distance++;
      }
    }
    return distance;
  }

  async close(): Promise<void> {
    this.save();
  }
}

// Singleton instance
let storageInstance: SQLiteStorage | null = null;

export function getStorage(dbPath?: string): SQLiteStorage {
  if (!storageInstance) {
    storageInstance = new SQLiteStorage(dbPath);
  }
  return storageInstance;
}

export async function initializeStorage(dbPath?: string): Promise<SQLiteStorage> {
  const storage = getStorage(dbPath);
  await storage.initialize();
  return storage;
}