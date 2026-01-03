/**
 * Cross-Platform Screenshot Service
 *
 * Provides reliable desktop screenshot capture across:
 * - Windows (PowerShell)
 * - macOS (screencapture)
 * - Linux (gnome-screenshot / scrot)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

/**
 * Capture a screenshot of the entire desktop.
 *
 * @returns Promise<Buffer> PNG image buffer
 * @throws Error if screenshot capture fails
 */
export async function captureScreenshot(): Promise<Buffer> {
  const tempFile = path.join(os.tmpdir(), `moire_screenshot_${Date.now()}.png`);
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Windows: Use PowerShell with System.Windows.Forms
      await captureWindows(tempFile);
    } else if (platform === 'darwin') {
      // macOS: Use built-in screencapture
      await captureMacOS(tempFile);
    } else {
      // Linux: Try gnome-screenshot, fall back to scrot
      await captureLinux(tempFile);
    }

    // Read the captured image
    if (!fs.existsSync(tempFile)) {
      throw new Error(`Screenshot file not created: ${tempFile}`);
    }

    const buffer = fs.readFileSync(tempFile);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    return buffer;

  } catch (error) {
    // Clean up temp file on error
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(`Screenshot failed on ${platform}: ${error}`);
  }
}

/**
 * Windows screenshot using PowerShell
 */
async function captureWindows(outputPath: string): Promise<void> {
  // Escape backslashes for PowerShell string
  const escapedPath = outputPath.replace(/\\/g, '\\\\');

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`.trim().replace(/\r?\n/g, '; ');

  await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, {
    timeout: 30000, // 30 second timeout
    windowsHide: true
  });
}

/**
 * macOS screenshot using screencapture
 */
async function captureMacOS(outputPath: string): Promise<void> {
  // -x: no sound, -C: capture cursor, -t png: format
  await execAsync(`screencapture -x -t png "${outputPath}"`, {
    timeout: 30000
  });
}

/**
 * Linux screenshot using gnome-screenshot or scrot
 */
async function captureLinux(outputPath: string): Promise<void> {
  // Try gnome-screenshot first (common on GNOME desktops)
  try {
    await execAsync(`gnome-screenshot -f "${outputPath}"`, {
      timeout: 30000
    });
    return;
  } catch {
    // gnome-screenshot not available, try scrot
  }

  // Try scrot (common on minimal setups)
  try {
    await execAsync(`scrot "${outputPath}"`, {
      timeout: 30000
    });
    return;
  } catch {
    // scrot not available, try import (ImageMagick)
  }

  // Try import from ImageMagick
  try {
    await execAsync(`import -window root "${outputPath}"`, {
      timeout: 30000
    });
    return;
  } catch {
    throw new Error('No screenshot tool available. Install gnome-screenshot, scrot, or imagemagick.');
  }
}

/**
 * Check if screenshot capture is available on this platform
 */
export async function isScreenshotAvailable(): Promise<boolean> {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // PowerShell is always available on modern Windows
      await execAsync('powershell -Command "echo test"', { timeout: 5000 });
      return true;
    } else if (platform === 'darwin') {
      // screencapture is always available on macOS
      await execAsync('which screencapture', { timeout: 5000 });
      return true;
    } else {
      // Linux: check for any screenshot tool
      try {
        await execAsync('which gnome-screenshot', { timeout: 5000 });
        return true;
      } catch {
        try {
          await execAsync('which scrot', { timeout: 5000 });
          return true;
        } catch {
          try {
            await execAsync('which import', { timeout: 5000 });
            return true;
          } catch {
            return false;
          }
        }
      }
    }
  } catch {
    return false;
  }
}

export default captureScreenshot;
