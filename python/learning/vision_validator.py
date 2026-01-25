"""
Vision Success Validator - Automatische Erfolgs-Erkennung via Claude CLI Vision.

Vergleicht Before/After Screenshots um zu bestimmen ob ein Task erfolgreich war.
"""
import json
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
import base64

# Find Claude CLI - on Windows it's 'claude.cmd'
CLAUDE_CLI = shutil.which('claude') or shutil.which('claude.cmd') or 'claude'


@dataclass
class ValidationResult:
    """Ergebnis der Vision-Validierung."""
    success: bool
    confidence: float
    reason: str
    observed_changes: List[str]
    validation_time_ms: float
    raw_response: Optional[str] = None


class VisionSuccessValidator:
    """
    Nutzt Claude CLI mit Vision um Task-Erfolg zu validieren.

    Vergleicht Before/After Screenshots und entscheidet ob
    das Goal erreicht wurde.

    Usage:
        validator = VisionSuccessValidator()

        # Screenshots aufnehmen
        before = await validator.capture_screenshot("before")

        # ... Task ausführen ...

        after = await validator.capture_screenshot("after")

        # Validieren
        result = await validator.validate_success(
            goal="öffne notepad und schreibe Hello",
            before_screenshot=before,
            after_screenshot=after
        )

        print(f"Success: {result.success} ({result.confidence:.0%})")
        print(f"Reason: {result.reason}")
    """

    def __init__(self, temp_dir: Optional[Path] = None):
        """
        Args:
            temp_dir: Verzeichnis für temporäre Screenshots.
                     Default: System temp / vision_validator
        """
        if temp_dir is None:
            temp_dir = Path(tempfile.gettempdir()) / "vision_validator"

        self.temp_dir = Path(temp_dir)
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        # Cleanup alte Screenshots (älter als 1 Stunde)
        self._cleanup_old_files()

    def _cleanup_old_files(self, max_age_hours: int = 1):
        """Entferne alte Screenshot-Dateien."""
        try:
            now = time.time()
            for f in self.temp_dir.glob("*.png"):
                if now - f.stat().st_mtime > max_age_hours * 3600:
                    f.unlink()
        except Exception:
            pass  # Cleanup ist optional

    def capture_screenshot_sync(self, name: str = "screenshot") -> Path:
        """
        Capture screen via PowerShell (synchron).

        Args:
            name: Name für die Screenshot-Datei (ohne Extension)

        Returns:
            Path zur gespeicherten Screenshot-Datei
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        screenshot_path = self.temp_dir / f"{name}_{timestamp}.png"

        # PowerShell Screenshot Command
        ps_script = f'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screens = [System.Windows.Forms.Screen]::AllScreens
$bounds = $screens[0].Bounds

$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$bitmap.Save("{screenshot_path}")
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Screenshot saved"
'''

        try:
            result = subprocess.run(
                ["powershell", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=10
            )

            if screenshot_path.exists():
                return screenshot_path
            else:
                raise RuntimeError(f"Screenshot not created: {result.stderr}")

        except subprocess.TimeoutExpired:
            raise RuntimeError("Screenshot capture timed out")
        except Exception as e:
            raise RuntimeError(f"Screenshot capture failed: {e}")

    async def capture_screenshot(self, name: str = "screenshot") -> Path:
        """
        Async wrapper für capture_screenshot_sync.

        Args:
            name: Name für die Screenshot-Datei

        Returns:
            Path zur gespeicherten Screenshot-Datei
        """
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.capture_screenshot_sync, name)

    def validate_success_sync(
        self,
        goal: str,
        before_screenshot: Path,
        after_screenshot: Path,
        timeout: int = 90
    ) -> ValidationResult:
        """
        Vergleiche Before/After Screenshots mit Claude CLI Vision (synchron).

        Args:
            goal: Das Task-Ziel (z.B. "öffne notepad und schreibe Hello")
            before_screenshot: Screenshot vor dem Task
            after_screenshot: Screenshot nach dem Task
            timeout: Timeout in Sekunden für Claude CLI

        Returns:
            ValidationResult mit success, confidence, reason
        """
        start_time = time.time()

        # Prüfe ob Screenshots existieren
        if not before_screenshot.exists():
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"Before screenshot not found: {before_screenshot}",
                observed_changes=[],
                validation_time_ms=0
            )

        if not after_screenshot.exists():
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"After screenshot not found: {after_screenshot}",
                observed_changes=[],
                validation_time_ms=0
            )

        # Vision Prompt - be very explicit about JSON output requirement
        prompt = f'''Du bist ein Vision-Validator. Deine EINZIGE Aufgabe ist es, zwei Screenshots zu vergleichen und zu bestimmen ob ein Ziel erreicht wurde.

ZIEL DAS ERREICHT WERDEN SOLLTE: {goal}

BILD 1 (erstes Bild): Zustand VOR der Aktion
BILD 2 (zweites Bild): Zustand NACH der Aktion

AUFGABE: Vergleiche die Bilder und antworte mit GENAU diesem JSON-Format (keine anderen Felder, kein anderer Text):

```json
{{
    "success": true oder false,
    "confidence": 0.0 bis 1.0,
    "reason": "Kurze Begruendung auf Deutsch",
    "observed_changes": ["Liste", "der", "Aenderungen"]
}}
```

Beispiel fuer Ziel "open notepad":
```json
{{
    "success": true,
    "confidence": 0.95,
    "reason": "Notepad Fenster ist im zweiten Bild sichtbar",
    "observed_changes": ["Neues Notepad-Fenster erschienen", "Leeres Textdokument geoeffnet"]
}}
```

WICHTIG: Antworte NUR mit dem JSON Block. Keine Erklaerungen davor oder danach!'''

        try:
            # Claude CLI mit Vision aufrufen
            # Note: Claude CLI doesn't have --image flag, so we include file paths in prompt
            # and use allowedTools to let Claude read the images
            full_prompt = f'''{prompt}

WICHTIG: Die Screenshot-Dateien sind hier:
- VORHER: {before_screenshot}
- NACHHER: {after_screenshot}

Lies beide Bilder mit dem Read-Tool und analysiere sie. Dann antworte mit dem JSON.'''

            result = subprocess.run(
                [
                    CLAUDE_CLI, "--print", "--output-format", "json",
                    "--allowedTools", "Read",
                    "-p", full_prompt
                ],
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors="replace"
            )

            validation_time = (time.time() - start_time) * 1000

            if result.returncode != 0:
                return ValidationResult(
                    success=False,
                    confidence=0.0,
                    reason=f"Claude CLI error: {result.stderr}",
                    observed_changes=[],
                    validation_time_ms=validation_time,
                    raw_response=result.stderr
                )

            # Parse JSON Response
            return self._parse_response(result.stdout, validation_time)

        except subprocess.TimeoutExpired:
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"Claude CLI timed out after {timeout}s",
                observed_changes=[],
                validation_time_ms=(time.time() - start_time) * 1000
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"Validation error: {e}",
                observed_changes=[],
                validation_time_ms=(time.time() - start_time) * 1000
            )

    async def validate_success(
        self,
        goal: str,
        before_screenshot: Path,
        after_screenshot: Path,
        timeout: int = 90
    ) -> ValidationResult:
        """
        Async wrapper für validate_success_sync.

        Args:
            goal: Das Task-Ziel
            before_screenshot: Screenshot vor dem Task
            after_screenshot: Screenshot nach dem Task
            timeout: Timeout in Sekunden

        Returns:
            ValidationResult
        """
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.validate_success_sync,
            goal,
            before_screenshot,
            after_screenshot,
            timeout
        )

    def _parse_response(self, response: str, validation_time: float) -> ValidationResult:
        """Parse Claude CLI Response zu ValidationResult."""
        import re

        try:
            response = response.strip()
            data = None

            # CASE 1: Claude CLI JSON output format (nested JSON)
            # {"type":"result","result":"```json\n{...}\n```"}
            try:
                outer = json.loads(response)
                if isinstance(outer, dict) and "result" in outer:
                    result_text = outer.get("result", "")
                    # Extract JSON from Markdown code blocks
                    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', result_text)
                    if json_match:
                        inner_json = json_match.group(1).strip()
                        data = json.loads(inner_json)
                    else:
                        # Try direct JSON parse
                        try:
                            data = json.loads(result_text)
                        except json.JSONDecodeError:
                            pass
            except json.JSONDecodeError:
                pass

            # CASE 2: Plain text with JSON (original behavior)
            if data is None:
                # Suche nach JSON Block (könnte in Markdown sein)
                if "```json" in response:
                    start = response.find("```json") + 7
                    end = response.find("```", start)
                    response = response[start:end].strip()
                elif "```" in response:
                    start = response.find("```") + 3
                    end = response.find("```", start)
                    response = response[start:end].strip()

                # Finde JSON Object
                start_idx = response.find("{")
                end_idx = response.rfind("}") + 1

                if start_idx == -1 or end_idx == 0:
                    return ValidationResult(
                        success=False,
                        confidence=0.0,
                        reason="Could not find JSON in response",
                        observed_changes=[],
                        validation_time_ms=validation_time,
                        raw_response=response
                    )

                json_str = response[start_idx:end_idx]
                data = json.loads(json_str)

            return ValidationResult(
                success=bool(data.get("success", False)),
                confidence=float(data.get("confidence", 0.0)),
                reason=str(data.get("reason", "No reason provided")),
                observed_changes=list(data.get("observed_changes", [])),
                validation_time_ms=validation_time,
                raw_response=response
            )

        except json.JSONDecodeError as e:
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"JSON parse error: {e}",
                observed_changes=[],
                validation_time_ms=validation_time,
                raw_response=response
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"Parse error: {e}",
                observed_changes=[],
                validation_time_ms=validation_time,
                raw_response=response
            )

    def get_screenshot_path(self, name: str) -> Path:
        """Generiere einen Screenshot-Pfad."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        return self.temp_dir / f"{name}_{timestamp}.png"


# Test
if __name__ == "__main__":
    import sys

    validator = VisionSuccessValidator()

    print("Vision Success Validator Test")
    print("=" * 50)

    if "--test" in sys.argv:
        # Simpler Test: Zwei Screenshots aufnehmen
        print("\n[1] Capturing 'before' screenshot...")
        before = validator.capture_screenshot_sync("test_before")
        print(f"    Saved: {before}")

        print("\n[2] Warte 3 Sekunden (mach etwas auf dem Bildschirm)...")
        time.sleep(3)

        print("\n[3] Capturing 'after' screenshot...")
        after = validator.capture_screenshot_sync("test_after")
        print(f"    Saved: {after}")

        print("\n[4] Validating with Claude CLI Vision...")
        result = validator.validate_success_sync(
            goal="irgendwas auf dem bildschirm geändert",
            before_screenshot=before,
            after_screenshot=after
        )

        print(f"\n" + "=" * 50)
        print("RESULT:")
        print(f"  Success: {result.success}")
        print(f"  Confidence: {result.confidence:.0%}")
        print(f"  Reason: {result.reason}")
        print(f"  Changes: {result.observed_changes}")
        print(f"  Time: {result.validation_time_ms:.0f}ms")

    else:
        print("\nUsage:")
        print("  python -m learning.vision_validator --test")
        print("\nThis will:")
        print("  1. Take a 'before' screenshot")
        print("  2. Wait 3 seconds (make changes on screen)")
        print("  3. Take an 'after' screenshot")
        print("  4. Use Claude CLI Vision to validate changes")
