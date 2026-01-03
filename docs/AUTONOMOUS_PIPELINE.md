# Autonomous Learning Pipeline

## Überblick

Die Autonomous Learning Pipeline ist ein vollständig automatisiertes System für kontinuierliches Icon-Lernen mit LLM-gesteuertem Training (RLAF - Reinforcement Learning from AI Feedback).

```
┌─────────────┐    ┌───────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌───────────┐
│   Screen    │ -> │ Detection │ -> │  Split  │ -> │   CNN   │ -> │  LLM     │ -> │  Training │
│   Capture   │    │  (C++/WS) │    │(Text/Icon)│   │ Classify│    │ Feedback │    │   Update  │
└─────────────┘    └───────────┘    └─────────┘    └─────────┘    └──────────┘    └───────────┘
     ↑                                                                  │
     └──────────────────────────────────────────────────────────────────┘
                              Alle X Sekunden wiederholen
```

## Features

### 🔄 Vollautomatischer Zyklus
- Screen Capture alle X Sekunden (konfigurierbar)
- Automatische Detection über C++ Backend oder WebSocket Bridge
- Kontinuierliches CNN-Training mit LLM-Feedback

### 🧠 Intelligentes LLM-Management
- LLM wird nur bei niedriger CNN-Konfidenz konsultiert
- **Auto-Disable bei 95% Accuracy**: Wenn eine Kategorie 95% Accuracy erreicht, wird das LLM für diese Kategorie automatisch deaktiviert
- Kosteneffizient: LLM-Aufrufe nur wenn nötig

### 📊 Echtzeit-Statistiken
- Accuracy-Tracking pro Kategorie
- LLM-Aufruf-Zähler
- Cycle-Zeit-Messung
- Visualisierung des Pipeline-Flows

## Architektur

### Komponenten

| Komponente | Datei | Beschreibung |
|------------|-------|--------------|
| AutonomousPipeline | `pipeline/autonomous-pipeline.ts` | Haupt-Orchestrator |
| ScreenCaptureService | `pipeline/autonomous-pipeline.ts` | Screenshot alle X sec via WebSocket |
| OCRService | `pipeline/autonomous-pipeline.ts` | HTTP-Client für Docker Tesseract |
| TextIconSplitter | `pipeline/autonomous-pipeline.ts` | Klassifiziert Boxes als Text/Icon |
| AccuracyTracker | `pipeline/autonomous-pipeline.ts` | Verfolgt Accuracy pro Kategorie |
| CNNIconClassifier | `classifiers/cnn-icon-classifier.ts` | TensorFlow.js CNN (65 Kategorien) |
| LLMGuidedTrainer | `classifiers/llm-guided-trainer.ts` | RLAF Training mit LLM-Feedback |
| LearningDataFrame | `classifiers/learning-dataframe.ts` | Speichert alle Trainingsdaten |

### Docker OCR Service

```yaml
# docker/docker-compose.yml
services:
  ocr:
    build:
      context: .
      dockerfile: Dockerfile.ocr
    ports:
      - "8080:8080"
```

**Starten:**
```bash
cd moire-canvas/docker
docker-compose up -d
```

### WebSocket Bridge Server

```bash
cd tools
node websocket-bridge-server.js
```

Port: `8765`

## Verwendung

### Browser Demo

```bash
cd moire-canvas
npx http-server -p 3333
# Öffne http://localhost:3333/test-pipeline.html
```

### Programmatisch

```typescript
import { createAutonomousPipeline } from '@moire/canvas';

const pipeline = createAutonomousPipeline({
  captureIntervalMs: 5000,      // Screen capture alle 5 sec
  cnnConfidenceThreshold: 0.7,  // LLM nur wenn CNN < 70% confident
  targetAccuracy: 0.95,         // LLM disable bei 95%
  wsUrl: 'ws://localhost:8765', // WebSocket Bridge
  ocrEndpoint: 'http://localhost:8080/ocr', // Docker OCR
  llmApiKey: 'sk-...',          // OpenAI oder Anthropic API Key
  llmProvider: 'openai'         // 'openai' oder 'anthropic'
});

// Stats-Updates empfangen
pipeline.onStats((stats) => {
  console.log('Processed:', stats.totalProcessed);
  console.log('LLM Calls:', stats.llmCalls);
  console.log('Disabled Categories:', stats.llmDisabledCategories);
});

// Pipeline starten
await pipeline.start();

// ... später stoppen
pipeline.stop();
pipeline.save(); // Daten persistieren
```

### Konfiguration

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `captureIntervalMs` | 5000 | Zeit zwischen Captures in ms |
| `cnnConfidenceThreshold` | 0.7 | CNN-Konfidenz unter der LLM konsultiert wird |
| `targetAccuracy` | 0.95 | Ziel-Accuracy für LLM-Deaktivierung |
| `wsUrl` | ws://localhost:8765 | WebSocket Bridge URL |
| `ocrEndpoint` | http://localhost:8080/ocr | Docker OCR Endpoint |

## Pipeline Flow

### 1. Screen Capture
- WebSocket-Befehl `run_detection` an Bridge Server
- C++ DetectIconsTemporal.exe erstellt `components_detected.bmp`
- CSV mit Bounding Boxes wird erzeugt

### 2. Text/Icon Split
```typescript
const splitter = new TextIconSplitter();
const { textBoxes, iconBoxes, buttonBoxes } = splitter.split(boxes);
```

**Heuristiken:**
- Aspect Ratio > 4 → Text
- OCR Confidence > 70% mit langem Text → Text
- Kleine quadratische Boxes < 100px → Icon
- OCR Text ≤ 3 Zeichen → Icon-Label

### 3. CNN Klassifikation
- 65 Icon-Kategorien (navigation, actions, media, system, files, ...)
- TensorFlow.js WebGL-Backend (GPU-beschleunigt)
- Input: 32x32x3 RGB

### 4. LLM-Feedback (RLAF)
```typescript
// Nur wenn CNN-Confidence < threshold UND LLM nicht disabled für Kategorie
if (cnnConfidence < 0.7 && accuracyTracker.isLLMNeeded(category)) {
  const llmResult = await llmProvider.analyzeIcon(imageBase64);
  trainer.addFeedback(imageData, cnnResult, llmResult);
}
```

### 5. Accuracy Tracking & Auto-Disable
```typescript
// Nach jedem Sample
accuracyTracker.update(category, cnnCorrect);

// Automatische Prüfung
if (tracker.samples >= 20 && tracker.accuracy >= 0.95) {
  tracker.llmDisabled = true;
  console.log(`🎉 "${category}" erreicht 95%! LLM deaktiviert.`);
}
```

### 6. Training Update
- Gewichtetes Cross-Entropy Loss
- Sample-Gewicht = |Reward|
- Reward-Berechnung:
  - CNN == LLM (beide confident): +0.5 bis +1.0
  - CNN != LLM (LLM confident): -1.0 bis 0

## Daten-Export

```typescript
// JSON Export
const data = pipeline.exportData();
fs.writeFileSync('training-data.json', JSON.stringify(data));

// CSV Export für Review
const csv = pipeline.getDataFrame().exportCSV();
```

## Statistiken

Die Pipeline trackt:
- `totalProcessed`: Gesamtzahl verarbeiteter Boxes
- `iconsClassified`: Anzahl klassifizierter Icons
- `llmCalls`: Anzahl LLM-API-Aufrufe
- `llmDisabledCategories`: Liste der Kategorien mit 95% Accuracy
- `accuracyByCategory`: Map mit Accuracy pro Kategorie
- `cycleTime`: Zeit pro Cycle in ms

## Test Dashboard

Das Test-Dashboard (`test-pipeline.html`) zeigt:
- Live Statistiken
- Accuracy-Bars pro Kategorie mit LLM-Status
- Activity Log
- Pipeline-Flow-Visualisierung
- Konfigurationsoptionen

## Performance

- Cycle-Zeit: ~1-2 Sekunden (ohne LLM)
- CNN Inference: ~50ms pro Icon
- LLM Call: ~500-2000ms (je nach Provider)
- Memory: ~200MB für CNN-Modell

## Troubleshooting

### WebSocket Bridge nicht erreichbar
```bash
# Terminal prüfen
cd tools && node websocket-bridge-server.js
```

### Docker OCR nicht verfügbar
```bash
# Container starten
cd moire-canvas/docker
docker-compose up -d

# Logs prüfen
docker-compose logs ocr
```

### CNN-Modell lädt nicht
- Prüfe ob TensorFlow.js geladen ist
- WebGL-Backend verfügbar?
- Fallback auf CPU mit `{ useGPU: false }`

## Roadmap

- [ ] Electron Native Screen Capture (ohne C++)
- [ ] IndexedDB für größere Datasets
- [ ] Transfer Learning für neue Kategorien
- [ ] A/B Testing verschiedener LLM-Provider