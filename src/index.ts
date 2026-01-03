/**
 * MoireTracker v2 - Cross-Platform Electron-Embeddable Detection Canvas
 * 
 * Main Entry Point - Exports all public APIs
 */

// Detection Pipelines
export { JSDetectionPipeline, DetectionConfig, DetectionResult as JSDetectionResult } from './detection/js-detection';
export { 
  AdvancedDetectionPipeline, 
  AdvancedDetectionConfig, 
  DetectionResult as AdvancedDetectionResult,
  DetectionBox,
  Region,
  LineGroup,
  getAdvancedDetection
} from './detection/advanced-detection';

// Server
export { MoireServer, MoireServerConfig, startServer } from './server/moire-server';

// Services
export { OCRService, getOCRService } from './services/ocr-service';
export { CNNClassifier, getCNNClassifier } from './services/cnn-service';

// Agent Team
export { getAgentTeam } from './agents/agent-team';

// Canvas Components (stable)
export { MoireCanvas } from './canvas/moire-canvas';
export { MoireEmbeddableCanvas as EmbeddableCanvas } from './canvas/embeddable-canvas';
export { MoireWebSocketClient } from './canvas/websocket-client';
export type { CanvasData, DetectionBox as CanvasBox, LayerVisibility } from './canvas/types';

// Version
export const VERSION = '2.0.0';

// Note: React, Electron, and Classifiers exports available via:
// - import { ... } from 'moire-tracker-v2/react'
// - import { ... } from 'moire-tracker-v2/electron'  
// - import { ... } from 'moire-tracker-v2/classifiers'
// These require additional setup (JSX, missing types).