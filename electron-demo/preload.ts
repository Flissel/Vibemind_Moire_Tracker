/**
 * Moiré Electron Demo - Preload Script
 * 
 * Exponiert die moireAPI dem Renderer Prozess
 */

import { exposeMoireAPI } from '../src/electron/index';

// Expose Moiré API to renderer
exposeMoireAPI();

console.log('[Preload] Moiré API exposed to renderer');