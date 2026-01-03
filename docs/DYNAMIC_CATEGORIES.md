# Dynamisches Kategorie-System

## Übersicht

Das dynamische Kategorie-System ermöglicht MoireTracker_v2 neue UI-Element-Kategorien 
automatisch zu lernen und hinzuzufügen, basierend auf LLM-Vorschlägen.

### Kernfeatures

- **Auto-Approve**: Nach 3 identischen LLM-Vorschlägen wird eine Kategorie automatisch genehmigt
- **Hierarchische Kategorien**: Parent-Child Beziehungen (z.B. `browser_icon` → `icon`)
- **Dynamische Prompts**: System-Prompt wird aus aktuellen Kategorien generiert
- **Persistenz**: Kategorien werden in JSON gespeichert und überleben Neustarts
- **TypeScript + Python Integration**: Beide Seiten laden aus derselben Registry

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    MoireTracker_v2                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────────────────────┐  │
│  │  categories.json │◄───│  CategoryRegistry (Python)        │  │
│  │  (Zentrale       │    │  - load/save                      │  │
│  │   Kategorie-DB)  │    │  - suggest_category()            │  │
│  └────────┬────────┘    │  - build_classification_prompt() │  │
│           │              └──────────────────────────────────┘  │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    Consumers                             │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐  │  │
│  │  │ cnn-service.ts  │  │ classification_worker.py    │  │  │
│  │  │ (TypeScript)    │  │ (Python)                    │  │  │
│  │  │ - loadCategories│  │ - LLM Classification       │  │  │
│  │  │ - validation    │  │ - NEW_CATEGORY handling    │  │  │
│  │  └─────────────────┘  └─────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐  │  │
│  │  │ active-learning │  │ AgentDataFrame              │  │  │
│  │  │ (TypeScript)    │  │ (Python)                    │  │  │
│  │  │ - dynamic dirs  │  │ - by_category_tree()       │  │  │
│  │  │ - manifest sync │  │ - hierarchical filters     │  │  │
│  │  └─────────────────┘  └─────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Kategorie-Registry (categories.json)

### Speicherort
```
MoireTracker_v2/python/config/categories.json
```

### Struktur

```json
{
  "categories": {
    "button": {
      "description": "Clickable button element that triggers an action",
      "examples": ["Submit Button", "Cancel Button", "OK"],
      "usageCount": 150,
      "createdBy": "default",
      "createdAt": "2024-01-01T00:00:00Z"
    },
    "browser_icon": {
      "description": "Desktop or taskbar icon for web browser applications",
      "examples": ["Chrome Browser", "Firefox Browser", "Microsoft Edge"],
      "parent": "icon",
      "usageCount": 25,
      "createdBy": "llm",
      "createdAt": "2024-12-10T15:30:00Z"
    }
  },
  "pending": {
    "game_icon": {
      "description": "Gaming application icon",
      "suggestedBy": "gemini-2.0-flash",
      "votes": 2,
      "firstSuggestedAt": "2024-12-12T10:00:00Z",
      "lastSuggestedAt": "2024-12-12T14:30:00Z",
      "parent": "icon",
      "examples": ["Steam", "Epic Games"]
    }
  },
  "settings": {
    "autoApproveThreshold": 3,
    "promptCacheMinutes": 5,
    "maxCategories": 100
  },
  "lastUpdated": "2024-12-12T14:30:00Z"
}
```

### Felder-Erklärung

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `description` | string | Beschreibung für LLM-Prompt |
| `examples` | string[] | Beispiele für diese Kategorie |
| `parent` | string? | Optional: Parent-Kategorie für Hierarchie |
| `usageCount` | number | Wie oft wurde diese Kategorie verwendet |
| `createdBy` | string | "default", "llm", oder "human" |
| `createdAt` | string | ISO 8601 Timestamp |

## Workflow: Neue Kategorie hinzufügen

### Flow-Diagramm

```
                    ┌──────────────────┐
                    │  LLM Klassifiziert│
                    │  UI Element       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
              ┌─────│ Kategorie        │─────┐
              │     │ bekannt?         │     │
              │     └──────────────────┘     │
              │                              │
         JA   │                              │  NEIN
              ▼                              ▼
    ┌──────────────────┐          ┌──────────────────┐
    │ Verwende         │          │ LLM schlägt      │
    │ bestehende       │          │ NEW_CATEGORY vor │
    │ Kategorie        │          └────────┬─────────┘
    └──────────────────┘                   │
                                           ▼
                                 ┌──────────────────┐
                                 │ suggest_category │
                                 │ aufrufen         │
                                 └────────┬─────────┘
                                          │
                                          ▼
                                 ┌──────────────────┐
                           ┌─────│ Bereits in       │─────┐
                           │     │ pending?         │     │
                           │     └──────────────────┘     │
                           │                              │
                      JA   │                              │  NEIN
                           ▼                              ▼
                 ┌──────────────────┐          ┌──────────────────┐
                 │ votes++          │          │ Neuer pending    │
                 └────────┬─────────┘          │ Eintrag          │
                          │                    │ votes = 1        │
                          ▼                    └────────┬─────────┘
                 ┌──────────────────┐                   │
           ┌─────│ votes >= 3?      │─────┐             │
           │     └──────────────────┘     │             │
           │                              │             │
      JA   │                              │  NEIN       │
           ▼                              ▼             ▼
 ┌──────────────────┐          ┌──────────────────────────┐
 │ AUTO-APPROVE!    │          │ Bleibt pending           │
 │ Kategorie wird   │          │ Wartet auf weitere       │
 │ hinzugefügt      │          │ Vorschläge               │
 └──────────────────┘          └──────────────────────────┘
```

## API Reference

### Python: CategoryRegistry

```python
from services.category_registry import CategoryRegistry, get_category_registry

# Singleton-Zugriff
registry = get_category_registry()

# Alle Kategorien
categories = registry.get_all_categories()
# ['button', 'icon', 'browser_icon', ...]

# Kategorie-Info
info = registry.get_category("browser_icon")
# {'description': '...', 'examples': [...], 'parent': 'icon', ...}

# Neue Kategorie vorschlagen
result = registry.suggest_category(
    name="game_icon",
    description="Gaming application icon",
    parent="icon",
    examples=["Steam", "Epic Games"]
)
# {'action': 'pending', 'votes': 1} oder
# {'action': 'approved', 'category': 'game_icon'}

# Hierarchie abfragen
children = registry.get_children("icon")
# ['browser_icon', 'editor_icon', 'system_icon', ...]

# Leaf-Kategorien (ohne Kinder)
leafs = registry.get_leaf_categories()
# ['browser_icon', 'button', 'input', ...]

# System-Prompt für LLM generieren
prompt = registry.build_classification_prompt()

# Statistiken
stats = registry.get_statistics()
# {'total_categories': 24, 'pending_categories': 2, ...}
```

### TypeScript: cnn-service.ts

```typescript
import { 
  loadCategoriesFromRegistry, 
  getCategoryRegistry,
  getLeafCategories,
  getCategoryHierarchy,
  reloadCategories 
} from './services/cnn-service';

// Kategorien laden (mit 5min Cache)
const categories = loadCategoriesFromRegistry();
// ['button', 'icon', 'browser_icon', ...]

// Vollständige Registry
const registry = getCategoryRegistry();

// Hierarchie
const hierarchy = getCategoryHierarchy();
// { 'icon': ['browser_icon', 'editor_icon'], ... }

// Leaf-Kategorien
const leafs = getLeafCategories();

// Force Reload
const fresh = reloadCategories();
```

### Python: AgentDataFrame

```python
from services.agent_dataframe import AgentDataFrame

adf = AgentDataFrame.from_dataframe(df)

# Alle Icons (inkl. Sub-Kategorien wie browser_icon)
all_icons = adf.by_category_tree("icon")

# Nur exakte Kategorie
browser_icons = adf.by_category("browser_icon")

# Verfügbare Kategorien
available = adf.get_available_categories()

# Kategorie-Statistiken
stats = adf.category_stats()
# {'used_categories': {...}, 'unused_categories': [...], ...}

# Dynamischer Zugriff (beliebige Kategorie als Methode)
buttons = adf.button()
browser_icons = adf.browser_icon()
taskbar_items = adf.taskbar_item()
```

## Hierarchie-Beispiel

```
icon (parent)
├── browser_icon      → Chrome, Firefox, Edge
├── editor_icon       → VS Code, Sublime, Notepad++
├── system_icon       → Settings, Control Panel
├── app_icon          → Generic applications
└── game_icon         → Steam, Epic Games, GOG

button (standalone)
input (standalone)
text (standalone)
container (standalone)
```

### Abfrage-Beispiele

```python
# Findet: Chrome (browser_icon), Settings (system_icon), etc.
all_icons = adf.by_category_tree("icon")

# Findet nur: Chrome, Firefox, Edge
browser_only = adf.by_category("browser_icon")
```

## Konfiguration

### Settings in categories.json

| Setting | Default | Beschreibung |
|---------|---------|--------------|
| `autoApproveThreshold` | 3 | Votes für Auto-Approve |
| `promptCacheMinutes` | 5 | Cache-Dauer für Prompts |
| `maxCategories` | 100 | Maximale Anzahl Kategorien |

### Umgebungsvariablen

| Variable | Beschreibung |
|----------|--------------|
| `MOIRE_CATEGORY_REGISTRY` | Alternativer Pfad zu categories.json |

## Integration: Classification Worker

Der Classification Worker wurde aktualisiert um:

1. **Dynamischen System-Prompt** zu verwenden
2. **NEW_CATEGORY Response** zu verarbeiten
3. **Auto-Approve** zu unterstützen

```python
# In classification_worker.py

# System-Prompt wird aus Registry generiert
system_prompt = registry.build_classification_prompt()

# Nach LLM-Response: NEW_CATEGORY handling
if result.get("category") == "new_category":
    suggestion = registry.suggest_category(
        name=result.get("suggested_name"),
        description=result.get("suggested_description"),
        parent=result.get("suggested_parent")
    )
    
    if suggestion["action"] == "approved":
        # Neue Kategorie wurde auto-approved!
        final_category = result.get("suggested_name")
    else:
        # Noch pending, verwende Parent oder "unknown"
        final_category = result.get("suggested_parent", "unknown")
```

## Tests ausführen

```bash
cd MoireTracker_v2/python
python -m pytest tests/test_dynamic_categories.py -v
```

Oder direkt:

```bash
python tests/test_dynamic_categories.py
```

## Best Practices

### 1. Kategorie-Namen
- Lowercase mit Underscores: `browser_icon`, `taskbar_item`
- Beschreibend und eindeutig
- Keine Sonderzeichen

### 2. Parent-Kategorien
- Nur bei echten "is-a" Beziehungen
- Max 2-3 Hierarchie-Ebenen
- Parent muss existieren

### 3. Beschreibungen
- Klar und prägnant
- Für LLM verständlich
- Mit 2-3 guten Beispielen

### 4. Monitoring
- Regelmäßig `pending` Kategorien prüfen
- Statistiken überwachen
- Low-Usage Kategorien reviewen

## Fehlerbehebung

### Kategorie wird nicht erkannt
1. Prüfe ob in `categories.json`
2. Cache neu laden: `reloadCategories()`
3. Logs auf Fehler prüfen

### Auto-Approve funktioniert nicht
1. Prüfe `autoApproveThreshold` in settings
2. Prüfe `votes` in pending
3. Kategorie-Namen müssen exakt matchen

### Hierarchie-Query liefert falsches
1. Prüfe `parent` Feld in categories.json
2. Verwende `by_category_tree()` nicht `by_category()`
3. Cache neu laden

## Changelog

### Version 1.0.0 (2024-12-12)
- Initial Release
- 24 Standard-Kategorien
- Hierarchie-Support
- Auto-Approve nach 3 Votes
- TypeScript + Python Integration