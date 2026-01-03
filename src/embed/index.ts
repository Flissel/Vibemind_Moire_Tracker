/**
 * Moire Canvas - Electron Embeddable Package
 * 
 * @example
 * ```typescript
 * import { MoireCanvas } from 'moire-canvas';
 * 
 * const canvas = new MoireCanvas({
 *   containerId: 'container',
 *   onDetection: (boxes) => console.log(boxes)
 * });
 * 
 * await canvas.init();
 * ```
 */

// Re-export everything from types
export * from './types';

// Default export for convenience
import { MoireCanvas } from './types';
export default MoireCanvas;