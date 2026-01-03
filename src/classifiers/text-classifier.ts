/**
 * Text Classifier
 * 
 * Klassifiziert OCR-Text ohne LLM durch:
 * 1. Regex-Pattern Matching
 * 2. Positions-basierte Heuristiken
 * 3. Kontext-Analyse (Nachbarn)
 */

import type {
  TextCategory,
  TextClassifier as ITextClassifier,
  ClassificationResult,
  ComponentType,
  Point
} from '../agents/types';

// ==================== Pattern Definitionen ====================

interface TextPattern {
  regex: RegExp;
  category: TextCategory;
  confidence: number;
  alternatives?: Array<{ category: TextCategory; confidence: number }>;
}

const TEXT_PATTERNS: TextPattern[] = [
  // Action Commands
  { regex: /^(Open|Öffnen|Save|Speichern|Close|Schließen|Exit|Beenden|Quit|Delete|Löschen|Remove|Entfernen|Create|Erstellen|New|Neu|Add|Hinzufügen|Edit|Bearbeiten|Copy|Kopieren|Paste|Einfügen|Cut|Ausschneiden|Undo|Rückgängig|Redo|Wiederholen|Find|Suchen|Replace|Ersetzen|Select|Auswählen|Import|Export|Print|Drucken|Share|Teilen|Refresh|Aktualisieren|Reload|Sync|Apply|Anwenden|Cancel|Abbrechen|OK|Yes|Ja|No|Nein|Submit|Absenden|Send|Senden|Upload|Download|Install|Installieren|Uninstall|Update|Aktualisieren|Run|Ausführen|Start|Stop|Pause|Resume|Fortsetzen|Restart|Neustarten)\.{0,3}$/i, category: 'action_command', confidence: 0.9 },
  
  // Navigation
  { regex: /^(Home|Start|Back|Zurück|Forward|Vorwärts|Next|Weiter|Previous|Zurück|Go to|Gehe zu|Jump to|Navigate|Settings|Einstellungen|Options|Optionen|Preferences|Help|Hilfe|About|Über|Info|Information|Menu|Menü|Tools|Werkzeuge|View|Ansicht|Window|Fenster|Tab|File|Datei|Folder|Ordner|Directory|Account|Konto|Profile|Profil|Dashboard|Overview|Übersicht)$/i, category: 'navigation', confidence: 0.85 },
  
  // Field Labels (endet mit :)
  { regex: /:$/, category: 'field_label', confidence: 0.9 },
  
  // Error Messages
  { regex: /^(Error|Fehler|Failed|Fehlgeschlagen|Invalid|Ungültig|Cannot|Kann nicht|Unable|Could not|Konnte nicht|Warning|Warnung|Alert|Problem|Issue|Exception|Crash|Critical|Fatal)/i, category: 'error', confidence: 0.85 },
  
  // Success Messages
  { regex: /^(Success|Erfolg|Successful|Erfolgreich|Complete|Fertig|Done|Erledigt|Saved|Gespeichert|Updated|Aktualisiert|Created|Erstellt|Deleted|Gelöscht|Confirmed|Bestätigt|Approved|Genehmigt|Valid|Gültig)/i, category: 'success', confidence: 0.85 },
  
  // Warnings
  { regex: /^(Warning|Warnung|Caution|Vorsicht|Attention|Achtung|Notice|Hinweis|Important|Wichtig)/i, category: 'warning', confidence: 0.85 },
  
  // Info
  { regex: /^(Info|Information|Note|Notiz|Tip|Tipp|Hint|Hinweis|Details|Loading|Laden|Please wait|Bitte warten|Processing|Verarbeite)/i, category: 'info', confidence: 0.8 },
  
  // Questions
  { regex: /\?$/, category: 'field_value', confidence: 0.5, alternatives: [{ category: 'action_command', confidence: 0.3 }] },
  
  // Paths
  { regex: /^[A-Z]:\\|^\/[a-z]+\/|^~\/|^\.\.\//i, category: 'path', confidence: 0.95 },
  { regex: /\.(exe|dll|sys|bat|cmd|ps1|sh|py|js|ts|html|css|json|xml|yaml|yml|md|txt|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|jpg|jpeg|png|gif|bmp|svg|mp3|mp4|wav|avi|mov|mkv)$/i, category: 'path', confidence: 0.9 },
  
  // URLs
  { regex: /^https?:\/\/\S+$/i, category: 'url', confidence: 0.95 },
  { regex: /^www\.\S+$/i, category: 'url', confidence: 0.9 },
  
  // Emails
  { regex: /^\S+@\S+\.\S+$/, category: 'email', confidence: 0.95 },
  
  // Dates
  { regex: /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/, category: 'date', confidence: 0.9 },
  { regex: /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/, category: 'date', confidence: 0.9 },
  { regex: /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i, category: 'date', confidence: 0.85 },
  
  // Numbers/Values
  { regex: /^[\d.,]+\s*(KB|MB|GB|TB|PB|B|Bytes?|kB)$/i, category: 'number', confidence: 0.9 },
  { regex: /^[\d.,]+\s*(px|pt|em|rem|%|°|°C|°F|Hz|kHz|MHz|GHz|ms|s|min|h|d)$/i, category: 'number', confidence: 0.9 },
  { regex: /^[\d.,]+$/, category: 'number', confidence: 0.7 },
  { regex: /^#[0-9A-Fa-f]{3,8}$/, category: 'number', confidence: 0.85 },  // Hex colors
  
  // Keyboard Shortcuts
  { regex: /(Ctrl|Alt|Shift|Cmd|⌘|⌥|⇧|⌃)\s*[+\-]\s*\w/i, category: 'shortcut', confidence: 0.95 },
  { regex: /^F\d{1,2}$/, category: 'shortcut', confidence: 0.9 },
  
  // Placeholders
  { regex: /^<[^>]+>$/, category: 'placeholder', confidence: 0.8 },
  { regex: /^\[[^\]]+\]$/, category: 'placeholder', confidence: 0.7 },
  { regex: /^(Enter|Type|Search|Filter|Input)\.{3}$/i, category: 'placeholder', confidence: 0.85 },
  { regex: /\.{3}$/, category: 'placeholder', confidence: 0.5 },
  
  // Status
  { regex: /^(Ready|Bereit|Idle|Aktiv|Active|Online|Offline|Connected|Verbunden|Disconnected|Getrennt|Enabled|Aktiviert|Disabled|Deaktiviert|On|An|Off|Aus|Running|Läuft|Stopped|Gestoppt|Pending|Ausstehend|Waiting|Wartend)$/i, category: 'status', confidence: 0.85 },
  { regex: /^\d+\s*\/\s*\d+$/, category: 'status', confidence: 0.7 },  // "3 / 10"
  { regex: /^\d+%$/, category: 'status', confidence: 0.8 },  // "75%"
];

// ==================== Position Heuristiken ====================

interface PositionContext {
  position: Point;
  windowSize: { width: number; height: number };
  parentType?: ComponentType;
  neighbors?: string[];
}

function classifyByPosition(text: string, context: PositionContext): ClassificationResult | null {
  const { position, windowSize, parentType, neighbors } = context;
  
  const relX = position.x / windowSize.width;
  const relY = position.y / windowSize.height;
  
  // Ganz oben (< 5% der Höhe) = wahrscheinlich Titel oder Menü
  if (relY < 0.05) {
    if (text.length < 20) {
      return { category: 'menu_item', confidence: 0.6 };
    }
    return { category: 'title', confidence: 0.7 };
  }
  
  // Ganz unten (> 95% der Höhe) = Status
  if (relY > 0.95) {
    return { category: 'status', confidence: 0.7 };
  }
  
  // Kontext: Parent-Typ
  if (parentType) {
    switch (parentType) {
      case 'menu_bar':
      case 'menu':
        return { category: 'menu_item', confidence: 0.85 };
      case 'toolbar':
        return { category: 'button_label', confidence: 0.8 };
      case 'form_field':
      case 'form':
        // Linke Seite = Label, Rechte Seite = Value
        if (relX < 0.3) {
          return { category: 'field_label', confidence: 0.7 };
        } else {
          return { category: 'field_value', confidence: 0.6 };
        }
      case 'status_bar':
        return { category: 'status', confidence: 0.85 };
      case 'dialog':
        // Buttons sind oft unten im Dialog
        if (relY > 0.7 && text.length < 15) {
          return { category: 'button_label', confidence: 0.7 };
        }
        break;
      case 'list':
      case 'list_item':
        return { category: 'field_value', confidence: 0.6 };
    }
  }
  
  // Kontext: Nachbarn
  if (neighbors && neighbors.length > 0) {
    // Wenn ein Nachbar mit : endet, ist dieser Text wahrscheinlich ein Value
    const hasLabelNeighbor = neighbors.some(n => n.endsWith(':'));
    if (hasLabelNeighbor) {
      return { category: 'field_value', confidence: 0.7 };
    }
  }
  
  return null;
}

// ==================== Text Classifier Klasse ====================

export interface TextClassifierOptions {
  defaultWindowSize?: { width: number; height: number };
  customPatterns?: TextPattern[];
}

export class TextClassifier implements ITextClassifier {
  private patterns: TextPattern[];
  private defaultWindowSize: { width: number; height: number };
  
  constructor(options: TextClassifierOptions = {}) {
    this.patterns = [...TEXT_PATTERNS, ...(options.customPatterns || [])];
    this.defaultWindowSize = options.defaultWindowSize || { width: 1920, height: 1080 };
  }
  
  /**
   * Klassifiziert einen Text
   */
  classify(
    text: string,
    context?: {
      position?: Point;
      neighbors?: string[];
      parentType?: ComponentType;
    }
  ): ClassificationResult {
    // Leerer Text
    if (!text || text.trim().length === 0) {
      return { category: 'unknown' as TextCategory, confidence: 0 };
    }
    
    const normalizedText = text.trim();
    let bestMatch: ClassificationResult = { category: 'label' as TextCategory, confidence: 0.3 };
    
    // 1. Pattern Matching
    for (const pattern of this.patterns) {
      if (pattern.regex.test(normalizedText)) {
        return {
          category: pattern.category,
          confidence: pattern.confidence,
          alternatives: pattern.alternatives
        };
      }
    }
    
    // 2. Positions-basierte Heuristiken
    if (context?.position) {
      const posResult = classifyByPosition(normalizedText, {
        position: context.position,
        windowSize: this.defaultWindowSize,
        parentType: context.parentType,
        neighbors: context.neighbors
      });
      
      if (posResult && posResult.confidence > 0.5) {
        return posResult;
      }
    }
    
    // 3. Längen-basierte Heuristiken
    if (normalizedText.length < 3) {
      // Sehr kurz = wahrscheinlich Symbol oder Shortcut
      return { category: 'unknown', confidence: 0.3, alternatives: [
        { category: 'shortcut', confidence: 0.2 }
      ]};
    }
    
    if (normalizedText.length > 100) {
      // Sehr lang = wahrscheinlich Info-Text
      return { category: 'info', confidence: 0.5 };
    }
    
    // 4. Wortarten-basierte Heuristiken
    const words = normalizedText.split(/\s+/);
    
    // Einzelnes Wort mit Großbuchstaben am Anfang = wahrscheinlich Button/Menü
    if (words.length === 1 && /^[A-ZÄÖÜ]/.test(normalizedText)) {
      return { category: 'button_label', confidence: 0.4, alternatives: [
        { category: 'navigation', confidence: 0.3 },
        { category: 'menu_item', confidence: 0.2 }
      ]};
    }
    
    // Mehrere Wörter mit Satzstruktur = Info
    if (words.length > 3 && /[.!]$/.test(normalizedText)) {
      return { category: 'info', confidence: 0.6 };
    }
    
    // Fallback
    return { category: 'unknown', confidence: 0.2 };
  }
  
  /**
   * Klassifiziert mehrere Texte als Batch
   */
  classifyBatch(
    texts: Array<{
      text: string;
      context?: {
        position?: Point;
        neighbors?: string[];
        parentType?: ComponentType;
      };
    }>
  ): ClassificationResult[] {
    return texts.map(item => this.classify(item.text, item.context));
  }
  
  /**
   * Fügt ein benutzerdefiniertes Pattern hinzu
   */
  addPattern(pattern: TextPattern): void {
    this.patterns.unshift(pattern);  // Am Anfang hinzufügen für höhere Priorität
  }
  
  /**
   * Setzt die Standard-Fenstergröße
   */
  setWindowSize(width: number, height: number): void {
    this.defaultWindowSize = { width, height };
  }
}

// ==================== Hilfs-Funktionen ====================

/**
 * Bestimmt ob ein Text actionable ist (klickbar/interagierbar)
 */
export function isActionableText(category: TextCategory): boolean {
  const actionableCategories: TextCategory[] = [
    'action_command',
    'navigation',
    'button_label',
    'menu_item',
    'url',
    'email'
  ];
  return actionableCategories.includes(category);
}

/**
 * Bestimmt den Interaktions-Typ basierend auf der Kategorie
 */
export function getInteractionType(category: TextCategory): 'click' | 'type' | 'select' | 'hover' | null {
  switch (category) {
    case 'action_command':
    case 'navigation':
    case 'button_label':
    case 'menu_item':
    case 'url':
    case 'email':
      return 'click';
    case 'field_value':
    case 'placeholder':
      return 'type';
    case 'option_label':
      return 'select';
    case 'tooltip':
      return 'hover';
    default:
      return null;
  }
}

// ==================== Factory ====================

export function createTextClassifier(options?: TextClassifierOptions): TextClassifier {
  return new TextClassifier(options);
}

export default TextClassifier;