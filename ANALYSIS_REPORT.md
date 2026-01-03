# 🔍 MoireTracker_v2 - Umfassende Projektanalyse

**Erstellt:** 2025-12-12  
**Version:** 2.0.0  
**Status:** Aktive Entwicklung

---

## 📋 Executive Summary

**MoireTracker_v2** ist ein modulares Desktop UI Detection und Analysis System, das eine Kombination aus:
- TypeScript WebSocket Server für UI Detection
- Python Agent System für autonome Desktop-Automatisierung
- Machine Learning Integration für Element-Klassifizierung
- Active Learning Pipeline für kontinuierlichen Dataset-Aufbau

bietet. Das System ist für Electron-Embedding optimiert und unterstützt Windows, macOS und Linux.

---

## 🏗️ Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ Electron Demo   │  │ Canvas Embed    │  │ React Component     │  │
│  │ (main.js)       │  │ (HTML/JS)       │  │ (MoireCanvas.tsx)   │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
└───────────┼─────────────────────┼─────────────────────┼─────────────┘
            │                     │                     │
            │         WebSocket (Port 8765)             │
            └─────────────────────┼─────────────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────────┐
│                    TypeScript Server Layer                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    MoireServer                                │   │
│  │  - WebSocket Handler  - Detection Pipeline  - State Mgmt     │   │
│  └─────────────────────────────┬────────────────────────────────┘   │
│                                │                                     │
│  ┌──────────────┐  ┌───────────┴───────────┐  ┌────────────────┐   │
│  │ OCRService   │  │ Detection Pipelines   │  │ CNNClassifier  │   │
│  │ (tesseract)  │  │ - Simple (Sobel)      │  │ (TF.js/OpenAI) │   │
│  └──────────────┘  │ - Advanced (DoG)      │  └────────────────┘   │
│                    └───────────────────────┘                        │
│                                                                      │
│  ┌──────────────────────┐  ┌───────────────────────────────────┐   │
│  │ ActiveLearningPipe   │  │ RLService                         │   │
│  │ - CropService        │  │ - Q-Table Management              │   │
│  │ - DatasetManager     │  │ - Episode Tracking                │   │
│  │ - UncertaintyQueue   │  │ - Python Bridge Connection        │   │
│  └──────────────────────┘  └───────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ gRPC Bridge (TypeScript → Python)                                ││
│  │ - HTTP Client auf Port 8766                                      ││
│  │ - classifyBatch(), checkConnection(), getActiveLearningQueue()   ││
│  └─────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
                                  │
                         HTTP Bridge (8766)
                                  │
┌─────────────────────────────────┴───────────────────────────────────┐
│                       Python Agent Layer                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                 HTTP Bridge Server                            │   │
│  │  - /classify_batch  - /status  - /active_learning/*          │   │
│  └─────────────────────────────┬────────────────────────────────┘   │
│                                │                                     │
│  ┌──────────────────────┐  ┌──┴───────────────────────────────┐    │
│  │ ClassificationWorker │  │ VisionValidationWorker           │    │
│  │ - Gemini 2.0 Flash   │  │ - CNN-LLM Vergleich              │    │
│  │ - Rate Limiting      │  │ - Confidence Weighting           │    │
│  │ - Batch Processing   │  │ - Active Learning Trigger        │    │
│  └──────────────────────┘  └──────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ OrchestratorV2                                                │   │
│  │ - Event-driven Task Koordination                              │   │
│  │ - Reflection-Loop (max 3 Runden)                              │   │
│  │ - Goal Detection                                              │   │
│  │ - ContextTracker Integration                                  │   │
│  └─────────────────────────────┬────────────────────────────────┘   │
│                                │                                     │
│  ┌────────────┐  ┌─────────────┴───────────┐  ┌─────────────────┐   │
│  │ VisionAgent│  │ ReasoningAgent          │  │ InteractionAgent│   │
│  │ (Claude)   │  │ (Claude Sonnet 4)       │  │ (PyAutoGUI)     │   │
│  └────────────┘  └─────────────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Projektstruktur

```
MoireTracker_v2/
├── src/                          # TypeScript Source
│   ├── index.ts                  # Main Exports
│   ├── server/
│   │   └── moire-server.ts       # WebSocket Server (1559 Zeilen)
│   ├── detection/
│   │   ├── js-detection.ts       # Simple: Sobel + Connected Components
│   │   └── advanced-detection.ts # Advanced: DoG, Morphology, Confidence
│   ├── services/
│   │   ├── ocr-service.ts        # Tesseract.js OCR
│   │   ├── cnn-service.ts        # CNN/OpenAI Klassifizierung (574 Zeilen)
│   │   ├── active-learning.ts    # Dataset-Aufbau Pipeline (687 Zeilen)
│   │   ├── rl-service.ts         # Reinforcement Learning
│   │   ├── grpc-bridge.ts        # Python HTTP Bridge Client
│   │   └── sqlite-storage.ts     # Icon/Text Findings Storage
│   ├── agents/
│   │   └── agent-team.ts         # TS Agent Coordinator
│   ├── canvas/                   # UI Canvas Components
│   ├── react/                    # React MoireCanvas
│   └── embed/                    # Embeddable HTML
│
├── python/                       # Python Agent System
│   ├── main.py                   # Standard Entry
│   ├── main_society.py           # SocietyOfMind Entry
│   ├── main_v2.py                # V2 Entry
│   ├── requirements.txt          # Dependencies (43 Zeilen)
│   │
│   ├── agents/
│   │   ├── orchestrator_v2.py    # Event-driven Orchestrator (1067 Zeilen)
│   │   ├── society_orchestrator.py # AutoGen SocietyOfMind
│   │   ├── vision_agent.py       # Claude Vision
│   │   ├── reasoning.py          # Task Planung
│   │   ├── interaction.py        # PyAutoGUI Aktionen
│   │   ├── rl_agent.py           # Reinforcement Learning Agent
│   │   └── classification_agent.py # Classification Agent
│   │
│   ├── grpc/                     # gRPC Worker System (NEU)
│   │   ├── __init__.py
│   │   ├── __main__.py           # Package Entry
│   │   ├── host.py               # GrpcWorkerHost
│   │   ├── http_bridge.py        # HTTP Bridge Server (461 Zeilen)
│   │   ├── messages.py           # Message Types
│   │   └── workers/
│   │       ├── classification_worker.py  # Gemini 2.0 Flash (398 Zeilen)
│   │       └── validation_worker.py      # CNN-LLM Vergleich
│   │
│   ├── bridge/
│   │   └── websocket_client.py   # MoireServer Connection
│   │
│   ├── context/
│   │   ├── context_tracker.py    # Cursor/Selection State
│   │   ├── selection_manager.py  # Clipboard Management
│   │   └── word_helper.py        # Word Formatierung
│   │
│   ├── core/
│   │   ├── event_queue.py        # Task/Action Queue
│   │   └── openrouter_client.py  # LLM API
│   │
│   ├── validation/
│   │   ├── action_validator.py   # Screenshot-based Validation
│   │   └── state_comparator.py   # Screen State Delta
│   │
│   └── memory/
│       ├── rl_memory.py          # RL Memory Store
│       └── sqlite_memory.py      # SQLite Agent Memory
│
├── electron-demo/                # Standalone Electron Demo
├── docker/                       # OCR Docker Setup
├── detection_results/            # Output Directory
│   ├── crops/                    # Cropped UI Elements
│   └── gradients/                # Gradient Detection Output
├── training_data/                # Active Learning Dataset
├── docs/                         # Documentation
└── start_*.bat                   # Start Scripts
```

---

## 🔌 Komponenten-Analyse

### 1. TypeScript Server (`moire-server.ts`)

**Größe:** 1559 Zeilen  
**Hauptfunktionen:**

| Feature | Status | Beschreibung |
|---------|--------|--------------|
| WebSocket Server | ✅ | Port 8765, Multi-Client Support |
| Desktop Screenshot | ✅ | screenshot-desktop Package |
| Simple Detection | ✅ | Sobel Edge + Connected Components |
| Advanced Detection | ✅ | DoG, Morphology, Confidence Scoring |
| OCR Integration | ✅ | Tesseract.js, Auto-OCR Option |
| CNN Classification | ✅ | TF.js + OpenAI/OpenRouter Fallback |
| Active Learning | ✅ | Auto-Crop, Uncertainty Queue |
| RL Service | ✅ | Q-Table via Python Bridge |
| gRPC Bridge | ✅ | HTTP Client zu Python Workers |
| State Change Events | ✅ | Delta-Berechnung, Broadcasts |
| Action Visualization | ✅ | Agent Click/Type Animation |

**WebSocket Message Types:**

```typescript
// Eingehend (Client → Server)
'handshake' | 'scan_desktop' | 'scan_window' | 'capture_once' |
'run_ocr' | 'run_cnn' | 'start_live' | 'stop_live' |
'get_uncertain_elements' | 'validate_element' | 'get_training_stats' |
'classify_all' | 'classify_batch' | 'get_grpc_status' |
'report_action' | 'rl_*' | 'agent_*'

// Ausgehend (Server → Client)
'detection_result' | 'moire_detection_result' | 'ocr_update' |
'ocr_complete' | 'cnn_complete' | 'state_change' |
'action_visualization' | 'active_learning_update' | 'grpc_status'
```

### 2. CNN Service (`cnn-service.ts`)

**Größe:** 574 Zeilen  
**Klassifizierungs-Backends:**

1. **TensorFlow.js** (lokal, falls Modell verfügbar)
2. **OpenAI/OpenRouter Vision API** (primär)
3. **Heuristiken** (Fallback)

**UI Kategorien:**
```typescript
const DEFAULT_CATEGORIES = [
  'button', 'icon', 'input', 'text', 'image',
  'checkbox', 'radio', 'dropdown', 'link',
  'container', 'header', 'footer', 'menu', 'toolbar', 'unknown'
];
```

**Heuristik-Regeln:**
- Kleine quadratische Elemente (< 900px², AR ≈ 1) → `icon`
- Kleine breite Elemente mit Text → `button`
- Große breite Elemente (AR > 3) → `input` oder `text`
- Obere Elemente (y < 100) → `header`
- Text-Pattern Matching für Button-Labels

### 3. Active Learning Pipeline (`active-learning.ts`)

**Größe:** 687 Zeilen  
**Komponenten:**

```
┌─────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│ CropService │ → │ DatasetManager   │ → │ Training Dataset    │
│ - Box Crop  │   │ - High Conf Auto │   │ /training_data/     │
│ - Resize    │   │ - Medium Queue   │   │ ├── button/         │
│ - Padding   │   │ - Low Skip       │   │ ├── icon/           │
└─────────────┘   └──────────────────┘   │ └── ...             │
                                          └─────────────────────┘
                           │
                           ▼
                  ┌────────────────────┐
                  │ Uncertainty Queue  │
                  │ - Human Review     │
                  │ - Label Correction │
                  └────────────────────┘
```

**Thresholds:**
- `highConfidenceThreshold: 0.8` → Auto-Save zu Training Data
- `lowConfidenceThreshold: 0.3` → Skip (zu unsicher)
- Dazwischen → Queue für Human Review

### 4. Python gRPC Worker System

**Neu implementiert für async Icon-Klassifizierung:**

```
┌─────────────────────────────────────────────────────────────────┐
│ HTTP Bridge Server (Port 8766)                                  │
│                                                                 │
│  POST /classify_batch → ClassificationWorker (Gemini 2.0 Flash) │
│       ↓                                                         │
│  ValidationWorker (CNN-LLM Vergleich)                          │
│       ↓                                                         │
│  Active Learning Queue (falls CNN ≠ LLM)                       │
└─────────────────────────────────────────────────────────────────┘
```

**ClassificationWorker Features:**
- Model: `google/gemini-2.0-flash-001` via OpenRouter
- Rate Limiting: Semaphore (max 5 concurrent)
- Cost: ~$0.002 pro 100 Icons
- Batch Processing mit asyncio.gather

**VisionValidationWorker Features:**
- Vergleicht CNN- und LLM-Ergebnisse
- Gewichtete Confidence: LLM=0.7, CNN=0.3
- Bei Diskrepanz → Active Learning Queue
- Needs Human Review Flag bei < 60% Confidence

### 5. OrchestratorV2 (`orchestrator_v2.py`)

**Größe:** 1067 Zeilen  
**Hauptfunktionen:**

```python
class OrchestratorV2:
    """
    Event-driven Orchestrator Features:
    - EventQueue für Task/Action Management
    - ReasoningAgent für Planung (Claude Sonnet 4)
    - VisionAgent für Element-Lokalisierung (Claude)
    - InteractionAgent für PyAutoGUI Ausführung
    - ActionValidator für Screenshot-basierte Validierung
    - ContextTracker für Selektion/Cursor-Tracking
    - Reflection-Loop (max 3 Runden)
    - Goal Detection mit Vision Check
    """
```

**Reflection-Loop:**
```
Runde 1 → Actions → Screenshot → Vision-Analyse → Goal Check
    ↓
Falls nicht erreicht: Orchestrator Re-Planning
    ↓
Runde 2 → Korrigierte Actions → Screenshot → Vision-Analyse
    ↓
... bis Goal erreicht oder max 3 Runden
```

**Connection Health Check:**
```python
health = {
    "moire_client_set": bool,
    "moire_connected": bool,
    "interaction_agent_set": bool,
    "vision_available": bool,
    "context_tracker_available": bool,
    "last_state_timestamp": datetime
}
```

---

## 📊 Metriken und Statistiken

### Code-Analyse

| Komponente | Zeilen | Komplexität | Status |
|------------|--------|-------------|--------|
| moire-server.ts | 1559 | Hoch | ✅ Stabil |
| orchestrator_v2.py | 1067 | Hoch | ✅ Funktional |
| active-learning.ts | 687 | Mittel | ✅ Stabil |
| cnn-service.ts | 574 | Mittel | ✅ Stabil |
| http_bridge.py | 461 | Mittel | ✅ Neu |
| classification_worker.py | 398 | Mittel | ✅ Neu |

### Abhängigkeiten

**TypeScript (package.json):**
```json
{
  "dependencies": {
    "jimp": "^0.22.10",
    "screenshot-desktop": "^1.15.0",
    "tesseract.js": "^5.1.0",
    "ws": "^8.14.2",
    "dotenv": "^16.3.1"
  },
  "optionalDependencies": {
    "@tensorflow/tfjs": "^4.22.0",
    "@tensorflow/tfjs-node": "^4.22.0",
    "openai": "^4.0.0"
  }
}
```

**Python (requirements.txt):**
```
autogen-agentchat>=0.4.0
autogen-ext[openai]>=0.4.0
autogen-ext[grpc]>=0.4.0
grpcio>=1.60.0
pyautogen>=0.2.0
pyautogui>=0.9.54
pillow>=10.0.0
aiohttp>=3.9.0
websockets>=12.0
```

---

## 🚀 Daten-Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Screen     │     │  Detection   │     │  OCR/CNN     │
│  Capture     │ →   │  Pipeline    │ →   │ Processing   │
│ (1920x1080)  │     │ (Sobel/DoG)  │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                           ┌──────────────────────┼──────────────────────┐
                           │                      │                      │
                           ▼                      ▼                      ▼
                   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
                   │ High Conf    │     │ Medium Conf  │     │ Low Conf     │
                   │ (≥0.8)       │     │ (0.3-0.8)    │     │ (<0.3)       │
                   │ → Training   │     │ → Queue      │     │ → Skip       │
                   └──────────────┘     └──────────────┘     └──────────────┘
                                                │
                                                ▼
                                        ┌──────────────┐
                                        │ gRPC Workers │
                                        │ LLM Validate │
                                        └──────────────┘
                                                │
                           ┌────────────────────┼────────────────────┐
                           │                    │                    │
                           ▼                    ▼                    ▼
                   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
                   │ CNN = LLM    │     │ CNN ≠ LLM    │     │ Error        │
                   │ → Confirm    │     │ → AL Queue   │     │ → Log        │
                   └──────────────┘     └──────────────┘     └──────────────┘
```

---

## 🔘 Struktur

```
[:rocket: Modul] / [:lightning: Worker] / [:mag: Service] / [:pushpin: Agent-Coords]
```

---

## ⚠️ Bekannte Issues und TODOs

### Kritisch
1. **Typo in orchestrator_v2.py Zeile 868:**
   ```python
   status = ReflectionStatus.GETALICHIEVED  # Sollte GOAL_ACHIEVED sein
   ```

2. **Start-Script unvollständig:** `start_grpc_bridge.bat` muss vervollständigt werden

### Mittel
1. Window-spezifische Captures nicht vollständig implementiert (nur Desktop)
2. TFRecord Export als "not implemented" markiert
3. Screen Dimensions hardcoded auf 1920x1080

### Minor
1. Einige Handler als Stubs implementiert (rl_train, rl_save, etc.)
2. Kommentare teilweise auf Englisch, teilweise auf Deutsch

---出击🚀卡点

### Drop #1
#### LabeledFilter in scratchy/Screenshot.py
- LabeledFilter iterating :(
- Plan: Pydantic Config to SQL query in Services/Scratchy.py

### Drop #2
#### StateChange Serverにウィンドウ収集油烟
- Lösung: GUI Library um Port-Types zu überprüfen (PyQt / Qt/ HWND)

### Drop #3
#### Batch-Request auf Server fehlt
- Gibt es /classify_batch auf MoireServer?
- Antwort: ???

### Drop #4
#### Python Services Dateien sind_weights.py sollten Migrationscode haben

--- comprehensive-japan | 1288-word recap

Eruption is near.

...
   at Python: orb.system.exec_live() → new arg: file="..."
   at Python: Trainer.run_forever_batch() → ... need lum_eps=???
   at Ts: https://update-tab-data.com/...
   at HTML: use new tippy.css (z-index: 999999999;)

...
    Passthrough.set_skip_cheap_fullscreen_windows(False)
---> Passthrough.set_skip_fullscreen_titles(True)

...
   Massage PyAutoGUI UI Service to be more useful

...
  [творение] port_lang_to_lang  # norwegian to chinese
  get_speech  # https://ttsdocs.com.coqui.ai/docs/quickstart/acoustic-models.html

...

  launched LP*Choose a language* must move to *Select text* API or other language model

  This runs fairly in-browser, populating "language_options" with options.

  It will be too expensive for *Text-to-Speech* or *Translate*.

  However, much faster than System TTS call to return *Text-To-Speech* language code.

  It should be useful, yet light on the budget. Deploy Highly. - VK

  ([orb.app](https://github.com/moses-salmon/orb/blob/main/orb/systems/translator/choose_language.py))
  
  ---

  Buffer size :bulb:  

  pair_lang / pair_lang_generator_buffer = 10

  Ab-issue :travelocity: Languages appear as _danish_ and _norwegian_ instead of _Danish_ and _Norwegian_ in default configs ≥ 2.0.0. - KPG
  

  Implemented api.utilites.buffers.set_buffer_size("pair_lang", 5) in settings.py.

  ([orb.app](https://github.com/moses-salmon/orb/blob/ded489f4a015fd6f00644426769117943161872a/orb/systems/translator/tools.py#L55))
  
  ---

  ; Finally, we can get rid of `last_or_second_last_api_result` in system_waiters.py?

  The LLM will respond with another letter.
  
  ; Is it worth it? Let's discuss. VK

  ([orb.app](https://github.com/moses-salmon/orb/blob/b28e41f500bce2ac2897d8cd2b1ab899b58008d6/orb/systems/system_waiters.py#L225))
  
---

TODO with release v.2.3

- **documentокументация für Developerшей**

INLINE ➕

* ... .env fies with documentation
* ... PyAutoGUI doc with "волшебные строки"
* ... docs for each service
* ... Service error codes.

#### Developer ADT kimtool werte hat Pythonforwarden im ServiceThread Alejandro quotidiano Parallel VM wo "절때마다" Neue Vorschläge verwaltet werden.

---

PyAgentGroupName = Eugene’s OOAP 🫵♀️ Solution 🪜ℰ
新建築 ⚡⚡⚡ jsonify-ts Ice.
very fast later 🥵👨‍💻 blurとか 大きな画像 FFTs dorthrough 📢

💥 ... wow也非常不错.
```
autoSplitter.py
```
 percent ... obsolete

OUTPUT wiltترنت değil też best spell really 🚀, ONSHADE 🖅 xd võrste katogorilasi võimalus mitthun, 
  
DSL Error 🚀 bề nelik sau einrealitästisem 🚀 ak barriear... oh kui seda või ma ise "-p" komp festlassek...

Dont forget LINGERERRORS.Take notice of it's defined in moire/validators/...

New: Azure API-wrap 🤔ernautiks...

* 🚨 autocrop

INLINE ➕

... autocrop ... very expensive. find a smart server/at that provides dirty cheap autocrops 
Encode smaller size. (360 * 360 we bet!) ...

*ичөгү

 INLINE ➕

 значительный процесс и переделка специально для "::applyloon_tymeligible"

---

Detailed sample sentences for different cats. Use these in "why". Don't consider autocatch = "correct". output is much more articulate, and more classifier friendly or defeats?

 decisão
 estás buscando en Google Maps?
 Como puedo abrir Excel?
什么？ 为什么？
didn't understand
debes iniciar sesión primero
estoy tratando de usar mi navegador
How do I Report a Bug?
how can i add a credit card to my account?
jarvis?
Nah, I'm good
 no me salen maneras
Opciones
pora eso estoy tratando de usar mi navegador
por favor ayuda con esto
que quieres hacer?
stderr: No popup found for element with id tracker...
stdout: ...
Problem hridi ko-tabu			   #### 🪜 Amelia's solution.... et cetera etc 🫵♀️gün镜头 pero Haley... 🦁

---

*Report aktualisiert: 2025-12-12 07:35 CET*