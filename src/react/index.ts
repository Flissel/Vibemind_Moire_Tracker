/**
 * @moire/canvas/react
 * 
 * React components and hooks for MoireCanvas integration.
 */

import { MoireCanvasReact, useMoireCanvas } from './MoireCanvas';
import type { MoireCanvasReactProps, MoireCanvasRef } from './MoireCanvas';

export {
  MoireCanvasReact,
  useMoireCanvas,
};

export type {
  MoireCanvasReactProps,
  MoireCanvasRef,
};

// Re-export types and provider for convenience
export type {
  DetectionBox,
  Region,
  CanvasData,
  LayerVisibility,
} from '../types';

export type {
  DesktopClient,
} from '../provider';

export default MoireCanvasReact;