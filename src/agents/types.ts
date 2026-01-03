/**
 * Agent Types for Classifiers
 */

export type IconCategory = 
  | 'sort' | 'filter' | 'user' | 'link' | 'menu' | 'unknown' | 'search' | 'message'
  | 'close' | 'stop' | 'copy' | 'paste' | 'pause' | 'play' | 'code' | 'warning' | 'info'
  | 'email' | 'folder' | 'file' | 'download' | 'upload' | 'save' | 'edit' | 'delete'
  | 'add' | 'remove' | 'back' | 'forward' | 'refresh' | 'home' | 'settings' | 'help'
  | 'lock' | 'unlock' | 'star' | 'heart' | 'share' | 'print' | 'camera' | 'microphone'
  | 'volume' | 'mute' | 'fullscreen' | 'minimize' | 'maximize' | 'notification' | 'calendar'
  | 'clock' | 'location' | 'arrow_up' | 'arrow_down' | 'arrow_left' | 'arrow_right'
  | 'check' | 'error_icon' | 'record' | 'attachment' | 'expand' | 'collapse';

export interface IconClassificationResult {
  category: IconCategory;
  confidence: number;
  alternatives?: Array<{ category: IconCategory; confidence: number }>;
}

export interface IconHash {
  phash: string;
  category: IconCategory;
  confidence: number;
}

export interface IconCache {
  get(hash: string): { category: IconCategory; confidence: number } | undefined;
  set(hash: string, category: IconCategory, confidence: number): void;
  has(hash: string): boolean;
  size(): number;
  export(): IconHash[];
  import(hashes: IconHash[]): void;
}

export interface IconClassifier {
  classify(
    imageData: Buffer | Uint8Array,
    width: number,
    height: number
  ): Promise<IconClassificationResult>;
  
  classifyBatch(
    images: Array<{ data: Buffer | Uint8Array; width: number; height: number }>
  ): Promise<IconClassificationResult[]>;
  
  addToCache(
    imageData: Buffer | Uint8Array,
    width: number,
    height: number,
    category: IconCategory,
    confidence?: number
  ): void;
  
  exportCache(): IconHash[];
  importCache(hashes: IconHash[]): void;
}

export interface TextClassificationResult {
  category: 'title' | 'label' | 'body' | 'button' | 'link' | 'input' | 'error' | 'unknown';
  confidence: number;
}

export interface TextClassifier {
  classify(text: string, context?: TextContext): Promise<TextClassificationResult>;
  classifyBatch(texts: Array<{ text: string; context?: TextContext }>): Promise<TextClassificationResult[]>;
}

export interface TextContext {
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  isClickable?: boolean;
  hasIcon?: boolean;
  backgroundColor?: string;
  position?: { x: number; y: number };
}