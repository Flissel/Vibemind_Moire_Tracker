"""
Validation Supervisor - Round-Robin Async Supervisor für Task-Validierung

Nutzt autogen_desktop Komponenten:
- StateComparator (Pixel-Diff) - schnell
- VisionAnalystAgent (LLM Vision) - genau

Round-Robin Pattern: Versucht schnellste Methode zuerst,
fällt auf genauere Methoden zurück wenn Confidence niedrig.
"""

import asyncio
import base64
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Dict, Any, List

# Load .env from MoireTracker_v2 directory FIRST (before any imports that might load other .env)
MOIRE_V2_PATH = Path(__file__).parent.parent.parent  # MoireTracker_v2/
MOIRE_V2_ENV = MOIRE_V2_PATH / ".env"
if MOIRE_V2_ENV.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(MOIRE_V2_ENV, override=True)
        print(f"[ValidationSupervisor] Loaded .env from {MOIRE_V2_ENV}")
    except ImportError:
        # Manual .env parsing if dotenv not available
        with open(MOIRE_V2_ENV, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")
        print(f"[ValidationSupervisor] Manually loaded .env from {MOIRE_V2_ENV}")

# Import from local MoireTracker_v2 modules (no need for autogen_desktop)
try:
    from validation.state_comparator import StateComparator, ScreenState, ComparisonResult, ChangeType
    STATE_COMPARATOR_AVAILABLE = True
except ImportError as e:
    STATE_COMPARATOR_AVAILABLE = False
    print(f"[ValidationSupervisor] StateComparator nicht verfuegbar: {e}")

try:
    from core.openrouter_client import OpenRouterClient, LLMResponse
    OPENROUTER_AVAILABLE = True
except ImportError as e:
    OPENROUTER_AVAILABLE = False
    print(f"[ValidationSupervisor] OpenRouterClient nicht verfuegbar: {e}")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


@dataclass
class ValidationResult:
    """Ergebnis der Task-Validierung."""
    success: bool
    confidence: float
    reason: str
    observed_changes: List[str]
    validation_method: str
    raw_data: Optional[Dict[str, Any]] = None


@dataclass
class FocusValidationResult:
    """Ergebnis der Focus-Validierung mit Vision."""
    success: bool
    detected_app: str
    detected_state: str  # "ready", "document", "start_screen", "dialog", "loading", "unknown"
    matches_expected_app: bool
    matches_expected_state: bool
    confidence: float
    reason: str
    raw_data: Optional[Dict[str, Any]] = None


class ContentTracker:
    """
    Tracks all typed/written content during a session.
    Provides context for LLM validation.
    """

    def __init__(self):
        self.entries: List[Dict[str, Any]] = []
        self.document_structure: List[str] = []  # High-level structure

    def add_typed_text(self, text: str, action: str = "type"):
        """Record typed text."""
        self.entries.append({
            "action": action,
            "content": text,
            "timestamp": asyncio.get_event_loop().time() if asyncio.get_event_loop().is_running() else 0
        })

    def add_formatting(self, formatting: str, target: str = "selection"):
        """Record formatting action."""
        self.entries.append({
            "action": "format",
            "formatting": formatting,
            "target": target
        })

    def add_structure(self, element: str):
        """Record document structure (headings, tables, etc.)."""
        self.document_structure.append(element)
        self.entries.append({
            "action": "structure",
            "element": element
        })

    def get_context_summary(self, max_chars: int = 2000) -> str:
        """Get summary of all content for LLM context."""
        lines = []
        lines.append("=== DOKUMENT-KONTEXT ===")

        # Document structure
        if self.document_structure:
            lines.append("\nStruktur:")
            for elem in self.document_structure[-10:]:  # Last 10
                lines.append(f"  - {elem}")

        # Recent content
        lines.append("\nGeschriebener Inhalt:")
        typed_content = [e for e in self.entries if e.get("action") == "type"]
        for entry in typed_content[-15:]:  # Last 15 typed items
            content = entry.get("content", "")
            if len(content) > 100:
                content = content[:100] + "..."
            lines.append(f"  > {content}")

        # Recent formatting
        format_actions = [e for e in self.entries if e.get("action") == "format"]
        if format_actions:
            lines.append("\nFormatierungen:")
            for entry in format_actions[-5:]:
                lines.append(f"  - {entry.get('formatting', '')} auf {entry.get('target', '')}")

        summary = "\n".join(lines)
        if len(summary) > max_chars:
            summary = summary[:max_chars] + "\n... (gekuerzt)"

        return summary

    def get_expected_text(self) -> List[str]:
        """Get list of all expected text in document."""
        return [e.get("content", "") for e in self.entries if e.get("action") == "type" and e.get("content")]

    def clear(self):
        """Clear all tracked content."""
        self.entries.clear()
        self.document_structure.clear()

    def save_to_file(self, path: Path):
        """Save content log to temp file."""
        import json
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({
                "entries": self.entries,
                "structure": self.document_structure
            }, f, ensure_ascii=False, indent=2)

    @classmethod
    def load_from_file(cls, path: Path) -> 'ContentTracker':
        """Load content log from temp file."""
        import json
        tracker = cls()
        if path.exists():
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                tracker.entries = data.get("entries", [])
                tracker.document_structure = data.get("structure", [])
        return tracker


# Global content tracker instance
_content_tracker: Optional[ContentTracker] = None

def get_content_tracker() -> ContentTracker:
    """Get or create global content tracker."""
    global _content_tracker
    if _content_tracker is None:
        _content_tracker = ContentTracker()
    return _content_tracker

def reset_content_tracker():
    """Reset global content tracker."""
    global _content_tracker
    _content_tracker = ContentTracker()


def _safe_print(msg: str):
    """Print with encoding protection for Windows console."""
    try:
        print(msg)
    except (UnicodeEncodeError, UnicodeDecodeError, LookupError, Exception):
        try:
            safe_msg = msg.encode('ascii', 'replace').decode('ascii')
            print(safe_msg)
        except:
            print("[LOG] (encoding error)")


class ValidationSupervisor:
    """
    Async Supervisor für Task-Validierung.

    Round-Robin Pattern:
    1. State Comparison (Pixel-Diff) - schnell, ~100ms
    2. LLM Vision (OpenRouter) - genau, ~2-5s

    Fällt auf genauere Methode zurück wenn Confidence < Threshold.
    """

    def __init__(
        self,
        openrouter_api_key: Optional[str] = None,
        confidence_threshold: float = 0.7
    ):
        """
        Args:
            openrouter_api_key: API Key für OpenRouter (oder aus OPENROUTER_API_KEY env)
            confidence_threshold: Ab diesem Wert wird State-Comparison akzeptiert
        """
        self.api_key = openrouter_api_key or os.getenv('OPENROUTER_API_KEY')
        self.confidence_threshold = confidence_threshold

        # Initialize components
        self.state_comparator: Optional[StateComparator] = None
        self.openrouter_client: Optional[OpenRouterClient] = None

        if STATE_COMPARATOR_AVAILABLE:
            self.state_comparator = StateComparator()
            _safe_print("[ValidationSupervisor] StateComparator verfuegbar")

        if OPENROUTER_AVAILABLE and self.api_key:
            self.openrouter_client = OpenRouterClient(api_key=self.api_key)
            _safe_print("[ValidationSupervisor] OpenRouter Client verfuegbar")
        elif not self.api_key:
            _safe_print("[ValidationSupervisor] Kein OPENROUTER_API_KEY - nur Pixel-Diff verfuegbar")

    def is_available(self) -> bool:
        """Prüft ob mindestens eine Validierungs-Methode verfügbar ist."""
        return self.state_comparator is not None or self.openrouter_client is not None

    async def validate_task(
        self,
        goal: str,
        before_screenshot: Path,
        after_screenshot: Path,
        timeout: float = 30.0,
        content_context: Optional[str] = None
    ) -> ValidationResult:
        """
        Validiere ob ein Task erfolgreich war.

        Round-Robin:
        1. Pixel-Diff (schnell) -> wenn Confidence > threshold, fertig
        2. LLM Vision (genau) -> als Fallback

        Args:
            goal: Das Ziel des Tasks (z.B. "open notepad")
            before_screenshot: Screenshot vor der Aktion
            after_screenshot: Screenshot nach der Aktion
            timeout: Timeout in Sekunden
            content_context: Optional context about what was typed/written

        Returns:
            ValidationResult
        """
        self._current_content_context = content_context  # Store for vision validation
        before_path = Path(before_screenshot)
        after_path = Path(after_screenshot)

        # Check files exist
        if not before_path.exists():
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"Before screenshot not found: {before_path}",
                observed_changes=[],
                validation_method="error"
            )

        if not after_path.exists():
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"After screenshot not found: {after_path}",
                observed_changes=[],
                validation_method="error"
            )

        # 1. Schnelle Methode: State Comparison (Pixel-Diff)
        if self.state_comparator:
            state_result = await self._validate_via_state(before_path, after_path)

            # Wenn Confidence hoch genug, verwende dieses Ergebnis
            if state_result.confidence >= self.confidence_threshold:
                _safe_print(f"[VALIDATION] State-Diff ausreichend (conf={state_result.confidence:.0%})")
                return state_result
            else:
                _safe_print(f"[VALIDATION] State-Diff niedrig (conf={state_result.confidence:.0%}), versuche LLM Vision...")

        # 2. Genaue Methode: LLM Vision
        if self.openrouter_client:
            try:
                vision_result = await asyncio.wait_for(
                    self._validate_via_vision(goal, before_path, after_path),
                    timeout=timeout
                )
                # Check if vision had an error - fallback to state_result
                if vision_result.validation_method.endswith("_error") and self.state_comparator:
                    _safe_print(f"[VALIDATION] LLM Vision Fehler, nutze State-Diff als Fallback")
                    return state_result
                return vision_result
            except asyncio.TimeoutError:
                _safe_print(f"[VALIDATION] LLM Vision Timeout nach {timeout}s")
                # Fallback auf State-Result wenn verfügbar
                if self.state_comparator:
                    return state_result
            except Exception as e:
                _safe_print(f"[VALIDATION] LLM Vision Exception: {e}")
                # Fallback auf State-Result wenn verfügbar
                if self.state_comparator:
                    return state_result

        # Fallback: State-Result wenn vorhanden, sonst Fehler
        if self.state_comparator and 'state_result' in locals():
            return state_result

        return ValidationResult(
            success=False,
            confidence=0.0,
            reason="Keine Validierungs-Methode verfuegbar",
            observed_changes=[],
            validation_method="none"
        )

    async def _validate_via_state(
        self,
        before_path: Path,
        after_path: Path
    ) -> ValidationResult:
        """Schnelle Pixel-Diff Validierung."""
        try:
            # Load screenshots as bytes
            with open(before_path, 'rb') as f:
                before_data = f.read()
            with open(after_path, 'rb') as f:
                after_data = f.read()

            # Create ScreenState objects
            state1 = ScreenState.from_screenshot(before_data)
            state2 = ScreenState.from_screenshot(after_data)

            # Compare
            result: ComparisonResult = self.state_comparator.compare(state1, state2)

            # Determine success based on change type
            # Significant change = task likely succeeded
            success = result.change_type in [
                ChangeType.SIGNIFICANT_CHANGE,
                ChangeType.MAJOR_CHANGE,
                ChangeType.NEW_WINDOW,
                ChangeType.ELEMENT_APPEARED
            ]

            # Build observed changes list
            changes = []
            if result.changed_regions:
                for region in result.changed_regions[:3]:
                    changes.append(f"Region {region.get('region', 'unknown')}: {region.get('change_percentage', 0)*100:.0f}% changed")

            if result.new_elements:
                for elem in result.new_elements[:3]:
                    changes.append(f"New: {elem.get('text', 'element')}")

            return ValidationResult(
                success=success,
                confidence=min(result.change_percentage * 2, 1.0),  # Scale to 0-1
                reason=result.description,
                observed_changes=changes,
                validation_method="state_comparator",
                raw_data={
                    "change_type": result.change_type.value,
                    "change_percentage": result.change_percentage
                }
            )

        except Exception as e:
            _safe_print(f"[VALIDATION] State comparison error: {e}")
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"State comparison failed: {e}",
                observed_changes=[],
                validation_method="state_comparator_error"
            )

    async def _validate_via_vision(
        self,
        goal: str,
        before_path: Path,
        after_path: Path
    ) -> ValidationResult:
        """LLM Vision Validierung (genaueste Methode)."""
        if not PIL_AVAILABLE:
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason="PIL not available for vision validation",
                observed_changes=[],
                validation_method="vision_error"
            )

        try:
            # Load and encode after screenshot (most important)
            with open(after_path, 'rb') as f:
                after_data = f.read()

            # Verify image is valid
            if len(after_data) < 1000:
                _safe_print(f"[VALIDATION] Warning: Image too small ({len(after_data)} bytes)")
                return ValidationResult(
                    success=False,
                    confidence=0.0,
                    reason=f"Screenshot too small: {len(after_data)} bytes",
                    observed_changes=[],
                    validation_method="vision_error"
                )

            # Verify it's a valid PNG
            if not after_data[:8] == b'\x89PNG\r\n\x1a\n':
                _safe_print(f"[VALIDATION] Warning: Not a valid PNG file")

            image_base64 = base64.b64encode(after_data).decode('utf-8')
            _safe_print(f"[VALIDATION] Image size: {len(after_data)} bytes, base64: {len(image_base64)} chars")

            # Build validation prompt - emphasize that there IS an image attached
            # Include content context if available
            context_section = ""
            if hasattr(self, '_current_content_context') and self._current_content_context:
                context_section = f"""
DOKUMENT-KONTEXT (was bisher geschrieben wurde):
{self._current_content_context}

"""

            prompt = f"""Du siehst einen Screenshot. Analysiere diesen Screenshot und bestimme ob folgendes Ziel erreicht wurde:

ZIEL: {goal}
{context_section}
Analysiere den Screenshot und pruefe:
1. Ist der erwartete Text/Inhalt im Dokument sichtbar?
2. Wurde die erwartete Aktion ausgefuehrt?
3. Stimmt der Bildschirminhalt mit dem Kontext ueberein?

Antworte NUR mit diesem JSON-Format:
{{
    "success": true/false,
    "confidence": 0.0-1.0,
    "reason": "Kurze Begruendung",
    "observed_changes": ["Liste", "der", "Aenderungen"]
}}

Beispiel fuer Ziel "type Abstract" mit Kontext:
{{
    "success": true,
    "confidence": 0.95,
    "reason": "Der Text 'Abstract' ist im Word-Dokument sichtbar",
    "observed_changes": ["Text 'Abstract' wurde eingegeben", "Cursor steht nach dem Text"]
}}"""

            # Call OpenRouter with vision
            response: LLMResponse = await self.openrouter_client.chat_with_vision(
                prompt=prompt,
                image_data=image_base64,  # image_data accepts base64 string
                json_mode=True
            )

            if response and response.content:
                import json
                try:
                    data = json.loads(response.content)
                    return ValidationResult(
                        success=data.get('success', False),
                        confidence=data.get('confidence', 0.0),
                        reason=data.get('reason', 'No reason'),
                        observed_changes=data.get('observed_changes', []),
                        validation_method="vision_llm",
                        raw_data=data
                    )
                except json.JSONDecodeError:
                    # Try to extract from markdown
                    import re
                    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response.content)
                    if json_match:
                        data = json.loads(json_match.group(1).strip())
                        return ValidationResult(
                            success=data.get('success', False),
                            confidence=data.get('confidence', 0.0),
                            reason=data.get('reason', 'No reason'),
                            observed_changes=data.get('observed_changes', []),
                            validation_method="vision_llm",
                            raw_data=data
                        )

            return ValidationResult(
                success=False,
                confidence=0.0,
                reason="No valid response from vision model",
                observed_changes=[],
                validation_method="vision_error"
            )

        except Exception as e:
            _safe_print(f"[VALIDATION] Vision error: {e}")
            return ValidationResult(
                success=False,
                confidence=0.0,
                reason=f"Vision validation failed: {e}",
                observed_changes=[],
                validation_method="vision_error"
            )

    async def _capture_active_window(self) -> Optional[bytes]:
        """
        Capture a screenshot of the currently active window.

        Returns:
            PNG image data as bytes, or None on error
        """
        try:
            import pyautogui
            import io

            # Capture full screen (we could optimize to just active window later)
            screenshot = pyautogui.screenshot()

            # Convert to PNG bytes
            buffer = io.BytesIO()
            screenshot.save(buffer, format='PNG')
            return buffer.getvalue()

        except Exception as e:
            _safe_print(f"[FOCUS-VISION] Screenshot error: {e}")
            return None

    async def validate_focus_with_vision(
        self,
        expected_app: str,
        expected_state: str = "ready"
    ) -> FocusValidationResult:
        """
        Universelle Focus-Validierung mit Claude Vision.

        Analysiert den aktuellen Screenshot und erkennt:
        - Welche App fokussiert ist
        - In welchem Zustand die App ist

        Args:
            expected_app: Erwartete App (z.B. "word", "notepad", "chrome")
            expected_state: Erwarteter Zustand:
                - "ready" = App bereit zur Eingabe
                - "document" = Leeres/neues Dokument offen
                - "start_screen" = Start-/Template-Screen (nicht erwuenscht)
                - "dialog" = Ein Dialog ist offen
                - "any" = Jeder Zustand OK

        Returns:
            FocusValidationResult mit erkannter App und Zustand
        """
        # Check if vision is available
        if not self.openrouter_client:
            _safe_print("[FOCUS-VISION] OpenRouter nicht verfuegbar, ueberspringe Vision-Check")
            return FocusValidationResult(
                success=True,  # Assume success if no vision available
                detected_app="unknown",
                detected_state="unknown",
                matches_expected_app=True,
                matches_expected_state=True,
                confidence=0.5,
                reason="Vision validation nicht verfuegbar",
                raw_data=None
            )

        # Capture screenshot
        screenshot_data = await self._capture_active_window()
        if not screenshot_data:
            return FocusValidationResult(
                success=False,
                detected_app="unknown",
                detected_state="unknown",
                matches_expected_app=False,
                matches_expected_state=False,
                confidence=0.0,
                reason="Screenshot fehlgeschlagen",
                raw_data=None
            )

        # Encode to base64
        image_base64 = base64.b64encode(screenshot_data).decode('utf-8')

        # Build prompt for Claude Vision
        prompt = f"""Analysiere diesen Screenshot des aktiven Fensters.

AUFGABE: Identifiziere die Anwendung und ihren Zustand.

FRAGEN:
1. Welche Anwendung ist zu sehen? (z.B. "microsoft_word", "notepad", "chrome", "excel", "file_explorer", etc.)
2. In welchem Zustand ist die App?
   - "ready" = App ist bereit fuer Eingaben (leeres Dokument, Textcursor sichtbar)
   - "document" = Ein Dokument ist geoeffnet und bearbeitbar
   - "start_screen" = Start-Bildschirm mit Vorlagen/Templates (z.B. Word Startseite)
   - "dialog" = Ein Dialog/Popup ist offen
   - "loading" = App laedt noch
   - "unknown" = Kann nicht bestimmt werden
3. Ist diese App: {expected_app}?
4. Ist der Zustand: {expected_state}?

WICHTIG bei Microsoft Word:
- Wenn du einen Bildschirm mit "Leeres Dokument", "Willkommen bei Word" oder Vorlagen siehst = "start_screen"
- Wenn du ein weisses Dokument mit Textcursor und Ribbon-Menue siehst = "ready" oder "document"

Antworte NUR mit diesem JSON-Format (keine Erklaerung davor oder danach):
{{
    "detected_app": "microsoft_word",
    "detected_state": "start_screen",
    "matches_expected_app": true,
    "matches_expected_state": false,
    "confidence": 0.95,
    "reason": "Word ist geoeffnet, zeigt aber den Template-Bildschirm statt ein leeres Dokument"
}}"""

        try:
            # Call Claude Vision
            response = await self.openrouter_client.chat_with_vision(
                prompt=prompt,
                image_data=image_base64,
                json_mode=True
            )

            if response and response.content:
                import json
                try:
                    # Try direct JSON parse
                    data = json.loads(response.content)
                except json.JSONDecodeError:
                    # Try to extract from markdown code block
                    import re
                    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response.content)
                    if json_match:
                        data = json.loads(json_match.group(1).strip())
                    else:
                        # Last resort: find JSON object in text
                        json_match = re.search(r'\{[\s\S]*\}', response.content)
                        if json_match:
                            data = json.loads(json_match.group(0))
                        else:
                            raise ValueError("No JSON found in response")

                detected_app = data.get('detected_app', 'unknown')
                detected_state = data.get('detected_state', 'unknown')
                matches_app = data.get('matches_expected_app', False)
                matches_state = data.get('matches_expected_state', False)
                confidence = data.get('confidence', 0.5)
                reason = data.get('reason', 'No reason provided')

                # Success = both app and state match (or state is "any")
                success = matches_app and (matches_state or expected_state == "any")

                _safe_print(f"[FOCUS-VISION] App: {detected_app}, State: {detected_state}, Success: {success}")

                return FocusValidationResult(
                    success=success,
                    detected_app=detected_app,
                    detected_state=detected_state,
                    matches_expected_app=matches_app,
                    matches_expected_state=matches_state,
                    confidence=confidence,
                    reason=reason,
                    raw_data=data
                )

        except Exception as e:
            _safe_print(f"[FOCUS-VISION] Error: {e}")

        return FocusValidationResult(
            success=False,
            detected_app="unknown",
            detected_state="unknown",
            matches_expected_app=False,
            matches_expected_state=False,
            confidence=0.0,
            reason=f"Vision validation failed",
            raw_data=None
        )

    async def close(self):
        """Cleanup resources."""
        if self.openrouter_client:
            await self.openrouter_client.close()


# Test
if __name__ == "__main__":
    import tempfile

    async def test():
        print("=== ValidationSupervisor Test ===\n")

        supervisor = ValidationSupervisor()
        print(f"Available: {supervisor.is_available()}")
        print(f"StateComparator: {supervisor.state_comparator is not None}")
        print(f"OpenRouter: {supervisor.openrouter_client is not None}")

        # Create dummy test files
        if PIL_AVAILABLE:
            img = Image.new('RGB', (100, 100), color='white')
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                img.save(f, 'PNG')
                before_path = Path(f.name)

            img2 = Image.new('RGB', (100, 100), color='blue')
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                img2.save(f, 'PNG')
                after_path = Path(f.name)

            print(f"\nTesting with dummy screenshots...")
            result = await supervisor.validate_task(
                goal="change screen color",
                before_screenshot=before_path,
                after_screenshot=after_path,
                timeout=10.0
            )

            print(f"\nResult:")
            print(f"  Success: {result.success}")
            print(f"  Confidence: {result.confidence:.0%}")
            print(f"  Method: {result.validation_method}")
            print(f"  Reason: {result.reason}")
            print(f"  Changes: {result.observed_changes}")

            # Cleanup
            before_path.unlink()
            after_path.unlink()

        await supervisor.close()

    asyncio.run(test())
