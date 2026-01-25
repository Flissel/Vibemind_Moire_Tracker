"""
Interaktive MCP Automation - Learning System

Alle Aktionen werden aufgezeichnet für Experience Learning.
Claude CLI wird für alle Tasks verwendet (Learning Mode).
Erfolgreiche Interaktionen werden als Training Data gespeichert.
"""
import asyncio
import sys
import os
import json
import time
import shutil
import re
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Dict, Any, Tuple, List

# Windows fix
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Learning System Import
try:
    from learning import MemoryCollector, AppClassifier, AppExplorer, VisionSuccessValidator, InputLock
    from learning import PatternStore, ActionStep, LLMTaskPlanner, TaskDecomposer
    LEARNING_AVAILABLE = True
    PATTERN_LEARNING_AVAILABLE = True
except ImportError as e:
    LEARNING_AVAILABLE = False
    PATTERN_LEARNING_AVAILABLE = False
    print(f"[WARN] Learning module not available: {e}")

# AutoGen ValidationSupervisor + ContentTracker Import
try:
    from learning.validation_supervisor import ValidationSupervisor, ContentTracker, get_content_tracker
    VALIDATION_SUPERVISOR_AVAILABLE = True
except ImportError as e:
    VALIDATION_SUPERVISOR_AVAILABLE = False
    ContentTracker = None
    get_content_tracker = None
    print(f"[WARN] ValidationSupervisor not available: {e}")

CLAUDE_CLI = shutil.which('claude') or 'claude'
MCP_CONFIG = Path(__file__).parent.parent / ".claude" / ".mcp.json"
CONFIG_FILE = Path(__file__).parent.parent / "config.json"

# Load default config
DEFAULT_CONFIG = {
    "learning_mode": True,
    "smart_mode": True,
    "use_vision_validation": True,
    "use_input_lock": True,
    "confidence_threshold": 0.7,
    "complexity_threshold": 2,
    "default_screen": "screen_0",
    "verbose": True
}

def load_config() -> Dict[str, Any]:
    """Load config from config.json or use defaults."""
    config = DEFAULT_CONFIG.copy()
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r') as f:
                user_config = json.load(f)
                config.update(user_config)
        except Exception as e:
            print(f"[WARN] Could not load config.json: {e}")
    return config

APP_CONFIG = load_config()


# ============================================================
# SCREEN & WINDOW MANAGEMENT
# ============================================================

def get_screens() -> List[Dict[str, Any]]:
    """Get all available screens with their positions."""
    try:
        import screeninfo
        monitors = screeninfo.get_monitors()
        return [{"id": i, "x": m.x, "y": m.y, "width": m.width, "height": m.height, "name": m.name}
                for i, m in enumerate(monitors)]
    except ImportError:
        return [{"id": 0, "x": 0, "y": 0, "width": 1920, "height": 1080, "name": "primary"}]


def move_window_to_screen(window_title: str, screen_id: int) -> bool:
    """Move a window to a specific screen."""
    try:
        import pygetwindow as gw
        screens = get_screens()

        if screen_id >= len(screens):
            print(f"[WINDOW] Screen {screen_id} not found. Available: 0-{len(screens)-1}")
            return False

        screen = screens[screen_id]

        # Find window by partial title match
        windows = gw.getWindowsWithTitle(window_title)
        if not windows:
            # Try case-insensitive search
            all_windows = gw.getAllWindows()
            windows = [w for w in all_windows if window_title.lower() in w.title.lower()]

        if not windows:
            print(f"[WINDOW] Window '{window_title}' not found")
            return False

        window = windows[0]

        # Calculate new position (center of target screen)
        new_x = screen["x"] + (screen["width"] - window.width) // 2
        new_y = screen["y"] + (screen["height"] - window.height) // 2

        # Move and activate
        window.moveTo(new_x, new_y)
        window.activate()

        print(f"[WINDOW] Moved '{window.title}' to Screen {screen_id} ({screen['x']},{screen['y']})")
        return True

    except Exception as e:
        print(f"[WINDOW] Error moving window: {e}")
        return False


# ============================================================
# PATTERN MATCHER - Entscheidet direkt vs Claude CLI
# ============================================================

@dataclass
class MatchResult:
    """Ergebnis des Pattern Matchings."""
    pattern: str           # z.B. "open_app", "type_text"
    params: Dict[str, Any] # z.B. {"app": "notepad", "text": "hello"}
    confidence: float      # 1.0 = exact match


class PatternMatcher:
    """Entscheidet ob Task direkt oder via Claude CLI ausgeführt wird."""

    # App Registry - welche Apps können geöffnet werden
    APP_MAP = {
        # Office
        "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
        "outlook": "outlook", "onenote": "onenote",
        # Editoren
        "notepad": "notepad", "editor": "notepad",
        # Browser
        "chrome": "chrome", "firefox": "firefox", "edge": "msedge",
        # System
        "calc": "calc", "rechner": "calc", "calculator": "calc",
        "paint": "mspaint", "terminal": "cmd", "cmd": "cmd",
        "powershell": "powershell", "explorer": "explorer",
    }

    # Shortcut Registry - Tastenkürzel für Aktionen
    SHORTCUTS = {
        # File operations
        "save": "ctrl+s",
        "save_as": "ctrl+shift+s",
        "new": "ctrl+n",
        "close": "alt+f4",
        # Edit operations
        "copy": "ctrl+c",
        "paste": "ctrl+v",
        "cut": "ctrl+x",
        "undo": "ctrl+z",
        "redo": "ctrl+y",
        "select_all": "ctrl+a",
        "find": "ctrl+f",
        "switch": "alt+tab",
        # Formatting
        "bold": "ctrl+b",
        "italic": "ctrl+i",
        "underline": "ctrl+u",
        # Alignment (Word/Office)
        "center": "ctrl+e",
        "left": "ctrl+l",
        "right": "ctrl+r",
        "justify": "ctrl+j",
        # Headings (Word)
        "heading1": "ctrl+alt+1",
        "heading2": "ctrl+alt+2",
        "heading3": "ctrl+alt+3",
        # Navigation
        "home": "ctrl+home",
        "end": "ctrl+end",
        "page_break": "ctrl+enter",
    }

    def match(self, task: str) -> Optional[MatchResult]:
        """Prüft ob Task einem bekannten Pattern entspricht.

        Returns:
            MatchResult wenn erkannt, None wenn unbekannt (→ Claude CLI)
        """
        task_lower = task.lower().strip()

        # ====== OPEN APP ======
        # "open notepad", "öffne word", "starte chrome"
        match = re.match(
            r'^(open|oeffne|offne|starte?)\s+(\w+)(?:\s+(?:and|und)\s+(.+))?$',
            task_lower
        )
        if match:
            app_name = match.group(2)
            additional = match.group(3)  # z.B. "type hello" oder "go to google.com"

            if app_name in self.APP_MAP:
                params = {"app": app_name, "cmd": self.APP_MAP[app_name]}

                # Check for additional actions
                if additional:
                    # "and type hello" / "und schreibe test"
                    type_match = re.match(r'(?:type|schreib[e]?|write)\s+(.+)', additional)
                    if type_match:
                        params["then_type"] = type_match.group(1)

                    # "and go to google.com" / "und gehe zu github.com"
                    url_match = re.match(r'(?:go\s*to|gehe?\s*zu|navigate\s*to)\s+(\S+)', additional)
                    if url_match:
                        params["then_url"] = url_match.group(1)

                return MatchResult("open_app", params, 1.0)

        # ====== TYPE TEXT ======
        # "type hello world", "schreibe Test"
        match = re.match(r'^(?:type|schreib[e]?|write)\s+["\']?(.+?)["\']?$', task, re.IGNORECASE)
        if match:
            return MatchResult("type_text", {"text": match.group(1).strip()}, 1.0)

        # ====== SAVE ======
        if re.match(r'^(?:save|speicher[n]?)(?:\s+as\s+|\s+als\s+)(.+)$', task_lower):
            match = re.match(r'^(?:save|speicher[n]?)(?:\s+as\s+|\s+als\s+)(.+)$', task_lower)
            return MatchResult("save_as", {"filename": match.group(1)}, 1.0)

        if re.match(r'^(?:save|speicher[n]?)$', task_lower):
            return MatchResult("shortcut", {"action": "save"}, 1.0)

        # ====== SIMPLE SHORTCUTS ======
        simple_patterns = [
            (r'^(?:copy|kopier[en]?)$', "copy"),
            (r'^(?:paste|einfueg[en]?|einfüg[en]?)$', "paste"),
            (r'^(?:cut|ausschneid[en]?)$', "cut"),
            (r'^(?:undo|rueckgaengig|rückgängig)$', "undo"),
            (r'^(?:redo|wiederhol[en]?)$', "redo"),
            (r'^(?:select\s*all|alles\s*(?:markier[en]?|auswaehl[en]?|auswähl[en]?))$', "select_all"),
            (r'^(?:close|schliess[en]?|beend[en]?)$', "close"),
            (r'^(?:switch|wechsel[n]?|alt-?tab)$', "switch"),
            (r'^(?:bold|fett)$', "bold"),
            (r'^(?:italic|kursiv)$', "italic"),
            (r'^(?:underline|unterstreich[en]?)$', "underline"),
            (r'^(?:new|neu(?:es)?\s*(?:doc|dokument|file|datei)?)$', "new"),
            # Alignment patterns
            (r'^(?:center|zentriere[n]?|mitte)$', "center"),
            (r'^(?:left|links|linksbuendig)$', "left"),
            (r'^(?:right|rechts|rechtsbuendig)$', "right"),
            (r'^(?:justify|blocksatz)$', "justify"),
            # Navigation patterns
            (r'^(?:home|anfang|start)$', "home"),
            (r'^(?:end|ende)$', "end"),
            (r'^(?:page\s*break|seitenumbruch)$', "page_break"),
        ]
        for pattern, action in simple_patterns:
            if re.match(pattern, task_lower):
                return MatchResult("shortcut", {"action": action}, 1.0)

        # ====== HEADINGS ======
        # "heading 1", "überschrift 2", "heading1"
        match = re.match(r'^(?:heading|ueberschrift|überschrift)\s*(\d)$', task_lower)
        if match:
            level = match.group(1)
            if level in ["1", "2", "3"]:
                return MatchResult("shortcut", {"action": f"heading{level}"}, 1.0)

        # ====== FIND/SEARCH ======
        match = re.match(r'^(?:find|such[e]?|search)\s+(?:for\s+|nach\s+)?(.+)$', task_lower)
        if match:
            return MatchResult("find", {"term": match.group(1)}, 1.0)

        # ====== SCROLL ======
        if re.match(r'^scroll\s*(?:down|runter|unten)$', task_lower):
            return MatchResult("scroll", {"direction": "down"}, 1.0)
        if re.match(r'^scroll\s*(?:up|hoch|oben)$', task_lower):
            return MatchResult("scroll", {"direction": "up"}, 1.0)

        # ====== SCREEN SCAN ======
        if re.match(r'^(?:scan|screenshot|screen|bildschirm)$', task_lower):
            return MatchResult("scan", {}, 1.0)

        # ====== WORKFLOW: JOB SCRAPER ======
        # "workflow jobs https://...", "workflow jobs anthropic"
        workflow_match = re.match(
            r'^workflow\s+jobs?\s*(.*)$',
            task_lower
        )
        if workflow_match:
            url_part = workflow_match.group(1).strip()
            # Extrahiere URL wenn vorhanden
            url_match = re.search(r'(https?://\S+)', task)
            url = url_match.group(1) if url_match else "https://www.anthropic.com/careers/jobs"

            # Extrahiere optionale Parameter
            count_match = re.search(r'(\d+)\s*jobs?', task_lower)
            job_count = int(count_match.group(1)) if count_match else 15

            return MatchResult("workflow_jobs", {
                "url": url,
                "job_count": job_count
            }, 1.0)

        # ====== MOVE WINDOW TO SCREEN ======
        # "move spotify to screen 2", "verschiebe chrome nach screen 1"
        match = re.match(
            r'^(?:move|verschieb[e]?)\s+(.+?)\s+(?:to|nach|auf)\s+screen\s*(\d+)$',
            task_lower
        )
        if match:
            return MatchResult("move_to_screen", {
                "window": match.group(1).strip(),
                "screen": int(match.group(2))
            }, 1.0)

        # ====== NOT MATCHED → Claude CLI ======
        return None


class MCPAutomation:
    """Learning-based Automation - Alle Aktionen werden aufgezeichnet."""

    def __init__(self, learning_mode: bool = None, config: Dict[str, Any] = None):
        # Use config or defaults
        cfg = config or APP_CONFIG

        self.current_screen = cfg.get("default_screen", "screen_0")
        self.verbose = cfg.get("verbose", True)
        self.learning_mode = learning_mode if learning_mode is not None else cfg.get("learning_mode", True)

        # Pattern Matcher für Hybrid-Routing
        self.pattern_matcher = PatternMatcher()

        # Session Context - wird zwischen Tasks weitergegeben
        self.session_context = []  # Liste von (task, result) Tupeln
        self.max_context_items = 5  # Letzte 5 Tasks merken

        # Learning System
        if LEARNING_AVAILABLE and learning_mode:
            self.memory_collector = MemoryCollector()
            self.app_classifier = AppClassifier()
            self.app_explorer = AppExplorer()
            self.vision_validator = VisionSuccessValidator()
            self.input_lock = InputLock()
            self.log("[LEARNING] Memory Collector + App Explorer + Vision Validator aktiviert")
            if self.input_lock.status.has_admin:
                self.log("[INPUT_LOCK] Admin-Rechte verfügbar - volle Sperrung möglich")
            else:
                self.log("[INPUT_LOCK] Keine Admin-Rechte - Soft Lock aktiv")
        else:
            self.memory_collector = None
            self.app_classifier = None
            self.app_explorer = None
            self.vision_validator = None
            self.input_lock = None

        # Vision validation settings
        self.use_vision_validation = False  # Old Claude CLI validator (disabled)

        # AutoGen ValidationSupervisor (new - Round-Robin async)
        if VALIDATION_SUPERVISOR_AVAILABLE:
            self.validation_supervisor = ValidationSupervisor()
            self.use_autogen_validation = self.validation_supervisor.is_available()
            if self.use_autogen_validation:
                self.log("[VALIDATION] AutoGen Supervisor aktiviert (Round-Robin: Pixel-Diff -> LLM Vision)")
            # Content Tracker for document context
            self.content_tracker = get_content_tracker()
            self.log("[VALIDATION] ContentTracker aktiviert fuer Dokument-Kontext")
        else:
            self.validation_supervisor = None
            self.use_autogen_validation = False
            self.content_tracker = None

        # Input Lock settings (from config)
        self.use_input_lock = cfg.get("use_input_lock", True)

        # Aktuelle App (wird dynamisch erkannt)
        self._current_app = "unknown"
        # Letzte geoeffnete App (fuer App-spezifische Behandlung)
        self._last_opened_app = None

        # Pattern Learning System (new)
        if PATTERN_LEARNING_AVAILABLE and self.learning_mode:
            self.pattern_store = PatternStore()
            self.task_decomposer = TaskDecomposer()
            self.llm_planner = LLMTaskPlanner(
                pattern_store=self.pattern_store,
                mcp_executor=self._mcp_execute
            )
            self.log(f"[LEARNING] Pattern Store: {len(self.pattern_store.patterns)} patterns loaded")
            self.log(f"[LEARNING] LLM Task Planner enabled")
        else:
            self.pattern_store = None
            self.task_decomposer = None
            self.llm_planner = None

        # Smart mode: use LLM planner for complex tasks (from config)
        self.smart_mode = cfg.get("smart_mode", True)
        self.complexity_threshold = cfg.get("complexity_threshold", 2)  # Tasks with more subtasks use LLM planner

    def add_context(self, task: str, result: str = "done"):
        """Füge Task zum Session-Context hinzu."""
        self.session_context.append({
            "task": task,
            "result": result,
            "screen": self.current_screen
        })
        # Nur die letzten N behalten
        if len(self.session_context) > self.max_context_items:
            self.session_context = self.session_context[-self.max_context_items:]

    def get_context_prompt(self) -> str:
        """Generiere Context-String für Prompt."""
        if not self.session_context:
            return ""

        lines = ["PREVIOUS ACTIONS IN THIS SESSION:"]
        for i, ctx in enumerate(self.session_context, 1):
            lines.append(f"  {i}. {ctx['task']} -> {ctx['result']}")
        lines.append("")
        return "\n".join(lines)

    def clear_context(self):
        """Lösche Session-Context."""
        self.session_context = []
        self.log("[CONTEXT] Session-Context gelöscht")

    def log(self, msg: str):
        if self.verbose:
            # Windows-Konsole kann Unicode nicht immer darstellen
            try:
                print(msg)
            except (UnicodeEncodeError, UnicodeDecodeError, LookupError, Exception):
                # LookupError catches charmap codec errors on Windows
                try:
                    safe_msg = msg.encode('ascii', 'replace').decode('ascii')
                    print(safe_msg)
                except:
                    print("[LOG] (encoding error)")

    # ====== LEARNING SYSTEM METHODS ======

    async def detect_current_app(self) -> str:
        """Erkenne die aktuelle App aus dem Fenstertitel."""
        if not self.app_classifier:
            return "unknown"

        try:
            import pygetwindow as gw
            active = gw.getActiveWindow()
            if active:
                app_name, category = self.app_classifier.classify(active.title)
                self._current_app = app_name
                return app_name
        except Exception as e:
            self.log(f"[LEARNING] App detection failed: {e}")

        return "unknown"

    def start_learning_episode(self, goal: str):
        """Starte eine Learning Episode für das gegebene Goal."""
        if not self.memory_collector:
            return

        # Erkenne aktuelle App
        try:
            import pygetwindow as gw
            active = gw.getActiveWindow()
            if active and self.app_classifier:
                app_name, _ = self.app_classifier.classify(active.title)
                self._current_app = app_name
            else:
                self._current_app = "unknown"
        except:
            self._current_app = "unknown"

        self.memory_collector.start_episode(self._current_app, goal)

    def record_action(self, tool: str, params: Dict, success: bool, duration_ms: float,
                      error: Optional[str] = None):
        """Zeichne eine Aktion für das Learning auf."""
        if not self.memory_collector:
            return

        self.memory_collector.record_action(
            tool=tool,
            params=params,
            success=success,
            duration_ms=duration_ms,
            error=error
        )

    def end_learning_episode(self, success: bool):
        """Beende die aktuelle Learning Episode."""
        if not self.memory_collector:
            return

        self.memory_collector.end_episode(success)

    def get_learning_stats(self) -> Dict:
        """Hole Learning Statistiken."""
        if not self.memory_collector:
            return {"learning_enabled": False}

        stats = self.memory_collector.get_statistics()
        stats["learning_enabled"] = True
        return stats

    async def explore_app(self, app_name: str = None, open_app: bool = False):
        """Erkunde eine App und sammle UI-Wissen.

        Args:
            app_name: Name der App (z.B. "notepad"). Wenn None, aktuelle App.
            open_app: Ob die App geöffnet werden soll
        """
        if not self.app_explorer:
            self.log("[EXPLORE] App Explorer nicht verfügbar")
            return None

        if app_name:
            knowledge = await self.app_explorer.explore_app(app_name, open_app=open_app)
        else:
            knowledge = await self.app_explorer.scan_current_app()

        self.log(f"\n[EXPLORE] App: {knowledge.app_name}")
        self.log(f"[EXPLORE] Window: {knowledge.window_title}")
        self.log(f"[EXPLORE] Elements: {knowledge.total_elements_found}")
        self.log(f"  - Menu: {len(knowledge.menu_bar)}")
        self.log(f"  - Toolbar: {len(knowledge.toolbar)}")
        self.log(f"  - Buttons: {len(knowledge.buttons)}")
        self.log(f"  - Shortcuts: {len(knowledge.shortcuts)}")

        return knowledge

    def list_explored_apps(self) -> List[str]:
        """Liste alle erkundeten Apps."""
        if not self.app_explorer:
            return []
        return self.app_explorer.list_explored_apps()

    # ====== PATTERN LEARNING METHODS ======

    async def _mcp_execute(self, action_type: str, params: Dict) -> Dict:
        """Execute an action via MCP-style interface (for LLMTaskPlanner)."""
        try:
            import pyautogui
            import pyperclip

            if action_type == "open_app":
                app = params.get("app", "")
                pyautogui.hotkey("win", "r")
                await asyncio.sleep(0.5)
                pyperclip.copy(app)
                pyautogui.hotkey("ctrl", "v")
                await asyncio.sleep(0.1)
                pyautogui.press("enter")
                await asyncio.sleep(2)
                return {"status": "ok", "action": "open_app", "app": app}

            elif action_type == "type_text" or action_type == "type":
                text = params.get("text", "")
                pyperclip.copy(text)
                pyautogui.hotkey("ctrl", "v")
                return {"status": "ok", "action": "type", "length": len(text)}

            elif action_type == "hotkey":
                keys = params.get("keys", "")
                key_list = keys.split("+")
                pyautogui.hotkey(*key_list)
                return {"status": "ok", "action": "hotkey", "keys": keys}

            elif action_type == "press":
                key = params.get("key", "")
                pyautogui.press(key)
                return {"status": "ok", "action": "press", "key": key}

            elif action_type == "click":
                x = params.get("x", 0)
                y = params.get("y", 0)
                pyautogui.click(x, y)
                return {"status": "ok", "action": "click", "x": x, "y": y}

            elif action_type == "scroll":
                direction = params.get("direction", "down")
                amount = params.get("amount", 3)
                if direction == "up":
                    pyautogui.scroll(amount)
                else:
                    pyautogui.scroll(-amount)
                return {"status": "ok", "action": "scroll", "direction": direction}

            elif action_type == "wait" or action_type == "sleep":
                seconds = params.get("seconds", 1)
                await asyncio.sleep(seconds)
                return {"status": "ok", "action": "wait", "seconds": seconds}

            elif action_type == "screen_scan":
                result = await self.screen_scan()
                return {"status": "ok", "action": "screen_scan", "lines": result.get("text_lines", [])}

            else:
                self.log(f"[MCP_EXECUTE] Unknown action: {action_type}")
                return {"status": "error", "action": action_type, "error": "unknown action"}

        except Exception as e:
            return {"status": "error", "action": action_type, "error": str(e)}

    async def find_learned_pattern(self, task: str) -> Optional[Tuple]:
        """Find a learned pattern for the task.

        Returns:
            (Pattern, score) if found with high confidence, None otherwise
        """
        if not self.pattern_store:
            return None

        result = self.pattern_store.find_pattern(task, min_confidence=0.7)
        if result:
            pattern, score = result
            self.log(f"[PATTERN] Found: {pattern.id} (score={score:.2f}, conf={pattern.confidence:.0%})")
            return result

        return None

    async def execute_learned_pattern(self, pattern) -> bool:
        """Execute a learned pattern.

        Args:
            pattern: Pattern object from PatternStore

        Returns:
            True if successful
        """
        self.log(f"[PATTERN] Executing: {pattern.id}")
        start_time = time.time()
        success = True

        try:
            for action in pattern.actions:
                tool = action.tool if isinstance(action, ActionStep) else action.get("tool", "")
                params = action.params if isinstance(action, ActionStep) else action.get("params", {})
                delay = action.delay_ms if isinstance(action, ActionStep) else action.get("delay_ms", 100)

                self.log(f"  [{tool}] {params}")
                result = await self._mcp_execute(tool, params)

                if result.get("status") == "error":
                    self.log(f"  [ERROR] {result.get('error')}")
                    success = False
                    break

                if delay > 0:
                    await asyncio.sleep(delay / 1000)

            duration_ms = (time.time() - start_time) * 1000

            # Record execution result
            pattern.record_execution(success, duration_ms)
            self.pattern_store.save()

            return success

        except Exception as e:
            self.log(f"[PATTERN] Error: {e}")
            pattern.record_execution(False, (time.time() - start_time) * 1000)
            self.pattern_store.save()
            return False

    async def run_with_llm_planner(self, task: str) -> bool:
        """Run task using LLM Task Planner with validation.

        This provides the highest accuracy for complex tasks:
        1. Claude decomposes task into validated steps
        2. Each step is executed and validated
        3. Only proceeds when validation passes
        4. Learns from successful execution

        Returns:
            True if task completed successfully
        """
        if not self.llm_planner:
            self.log("[PLANNER] LLM Planner not available, falling back to Claude CLI")
            return await self.run_claude_task(task)

        self.log(f"\n{'='*50}")
        self.log(f"LLM TASK PLANNER: {task[:50]}...")
        self.log(f"{'='*50}")

        try:
            # Create validated execution plan
            plan = await self.llm_planner.create_plan(task)
            self.log(f"\n[PLAN] Created {len(plan.steps)} steps:")
            for step in plan.steps:
                self.log(f"  [{step.id}] {step.description}")

            # Execute with validation
            async def on_step_complete(plan, step):
                progress = plan.get_progress()
                self.log(f"  Progress: {progress['completed']}/{progress['total']} ({progress['progress_percent']:.0f}%)")

            success = await self.llm_planner.execute_plan(plan, on_step_complete=on_step_complete)

            self.log(f"\n[PLAN] Result: {'SUCCESS' if success else 'FAILED'}")

            # Stats
            stats = self.llm_planner.get_stats()
            self.log(f"[PLAN] Stats: {stats['plans_completed']}/{stats['plans_created']} plans, "
                    f"{stats['success_rate']:.0f}% success rate")

            return success

        except Exception as e:
            self.log(f"[PLANNER] Error: {e}")
            self.log(f"[PLANNER] Falling back to Claude CLI...")
            return await self.run_claude_task(task)

    def get_pattern_stats(self) -> Dict:
        """Get pattern learning statistics."""
        if not self.pattern_store:
            return {"pattern_learning_enabled": False}

        stats = self.pattern_store.get_stats()
        stats["pattern_learning_enabled"] = True

        if self.llm_planner:
            stats["planner_stats"] = self.llm_planner.get_stats()

        return stats

    # ====== DIREKTE TOOL IMPLEMENTIERUNGEN ======
    # Diese nutzen pyautogui/pygetwindow direkt

    async def screen_scan(self, screen_id: str = None) -> dict:
        """Scanne Screen mit OCR."""
        screen_id = screen_id or self.current_screen
        self.log(f"[SCAN] {screen_id}")

        try:
            import pyautogui
            from PIL import Image
            import pytesseract

            # Screenshot
            screenshot = pyautogui.screenshot()

            # Für Multi-Monitor: Region basierend auf screen_id
            # screen_0: x >= 0, screen_1: x < 0
            width, height = screenshot.size

            # OCR
            try:
                text = pytesseract.image_to_string(screenshot)
                lines = [l.strip() for l in text.split('\n') if l.strip()]
                self.log(f"  Gefunden: {len(lines)} Textzeilen")
                for line in lines[:5]:
                    self.log(f"    - {line[:60]}")
                return {"screen_id": screen_id, "text_lines": lines, "count": len(lines)}
            except Exception as e:
                self.log(f"  [WARN] OCR nicht verfügbar: {e}")
                return {"screen_id": screen_id, "error": str(e)}

        except ImportError as e:
            self.log(f"  [ERROR] Modul fehlt: {e}")
            return {"error": str(e)}

    async def screen_focus(self) -> dict:
        """Zeige fokussiertes Fenster."""
        self.log("[FOCUS]")

        try:
            import pygetwindow as gw

            active = gw.getActiveWindow()
            if active:
                result = {
                    "title": active.title,
                    "x": active.left,
                    "y": active.top,
                    "width": active.width,
                    "height": active.height
                }
                self.log(f"  Fenster: {active.title}")
                self.log(f"  Position: x={active.left}, y={active.top}")
                self.log(f"  Größe: {active.width}x{active.height}")

                # Bestimme Screen
                if active.left < 0:
                    screen = "screen_1"
                else:
                    screen = "screen_0"
                result["screen"] = screen
                self.log(f"  Screen: {screen}")

                return result
            else:
                self.log("  Kein aktives Fenster")
                return {"error": "no_active_window"}

        except ImportError:
            self.log("  [ERROR] pygetwindow nicht installiert")
            return {"error": "pygetwindow not installed"}

    async def action_click(self, x: int, y: int) -> dict:
        """Klicke auf Koordinaten."""
        self.log(f"[CLICK] ({x}, {y})")

        try:
            import pyautogui
            pyautogui.click(x, y)
            self.log(f"  OK")
            return {"status": "clicked", "x": x, "y": y}
        except Exception as e:
            self.log(f"  [ERROR] {e}")
            return {"error": str(e)}

    async def action_type(self, text: str) -> dict:
        """Tippe Text. Nutzt Clipboard für Unicode (Umlaute etc.)."""
        display_text = text[:30] + '...' if len(text) > 30 else text
        self.log(f"[TYPE] '{display_text}'")

        try:
            import pyautogui

            # Check if text contains non-ASCII (Unicode like ö, ü, ä, ß)
            is_ascii = all(ord(c) < 128 for c in text)

            if is_ascii:
                # ASCII-only: typewrite is safe
                pyautogui.typewrite(text, interval=0.02)
                self.log(f"  OK (typewrite)")
                return {"status": "typed", "length": len(text)}
            else:
                # Unicode: use clipboard (typewrite silently fails on non-ASCII)
                import pyperclip
                pyperclip.copy(text)
                await asyncio.sleep(0.05)  # Small delay for clipboard
                pyautogui.hotkey('ctrl', 'v')
                self.log(f"  OK (clipboard - Unicode)")
                return {"status": "typed_clipboard", "length": len(text)}

        except Exception as e:
            # Fallback: try clipboard anyway
            try:
                import pyperclip
                import pyautogui
                pyperclip.copy(text)
                pyautogui.hotkey('ctrl', 'v')
                self.log(f"  OK (clipboard fallback)")
                return {"status": "typed_clipboard", "length": len(text)}
            except Exception as e2:
                self.log(f"  [ERROR] {e2}")
                return {"error": str(e2)}

    async def action_hotkey(self, keys: str) -> dict:
        """Tastenkombination."""
        self.log(f"[HOTKEY] {keys}")

        try:
            import pyautogui
            key_list = keys.lower().split('+')
            pyautogui.hotkey(*key_list)
            self.log(f"  OK")
            return {"status": "pressed", "keys": keys}
        except Exception as e:
            self.log(f"  [ERROR] {e}")
            return {"error": str(e)}

    async def action_press(self, key: str) -> dict:
        """Einzelne Taste."""
        self.log(f"[PRESS] {key}")

        try:
            import pyautogui
            pyautogui.press(key)
            self.log(f"  OK")
            return {"status": "pressed", "key": key}
        except Exception as e:
            self.log(f"  [ERROR] {e}")
            return {"error": str(e)}

    async def screen_find(self, text: str) -> dict:
        """Finde Text auf Screen."""
        self.log(f"[FIND] '{text}'")

        # Scan und suche
        scan = await self.screen_scan()
        if "text_lines" in scan:
            matches = [l for l in scan["text_lines"] if text.lower() in l.lower()]
            if matches:
                self.log(f"  Gefunden: {len(matches)} Treffer")
                for m in matches[:3]:
                    self.log(f"    - {m[:60]}")
                return {"found": True, "matches": matches}
            else:
                self.log(f"  Nicht gefunden")
                return {"found": False}
        return scan

    # ====== VALIDIERUNG ======

    async def validate_app_focus_vision(
        self,
        expected_app: str,
        expected_state: str = "ready",
        max_retries: int = 3
    ) -> dict:
        """
        Universelle Focus-Validierung mit Claude Vision.

        Args:
            expected_app: Erwartete App (z.B. 'word', 'notepad', 'chrome')
            expected_state: Erwarteter Zustand:
                - "ready" = App bereit zur Eingabe
                - "document" = Leeres/neues Dokument offen
                - "start_screen" = Start-/Template-Screen
                - "any" = Jeder Zustand OK
            max_retries: Anzahl Versuche

        Returns:
            {
                "success": bool,
                "detected_app": str,
                "detected_state": str,
                "confidence": float,
                "reason": str
            }
        """
        # Use ValidationSupervisor if available
        if self.validation_supervisor:
            for attempt in range(max_retries):
                self.log(f"  [FOCUS-VISION] Versuch {attempt+1}: Pruefe {expected_app} ({expected_state})...")

                result = await self.validation_supervisor.validate_focus_with_vision(
                    expected_app=expected_app,
                    expected_state=expected_state
                )

                if result.success:
                    self.log(f"  [FOCUS-OK] {result.detected_app} im Zustand '{result.detected_state}' ({result.confidence:.0%})")
                    return {
                        "success": True,
                        "detected_app": result.detected_app,
                        "detected_state": result.detected_state,
                        "confidence": result.confidence,
                        "reason": result.reason
                    }

                # Check if it's a start_screen - we can try to fix this
                if result.detected_state == "start_screen" and result.matches_expected_app:
                    self.log(f"  [FOCUS-FIX] Start-Screen erkannt, versuche Escape...")
                    await self.action_press("escape")
                    await asyncio.sleep(1.0)
                    continue

                self.log(f"  [FOCUS-CHECK] {result.reason}")

                if attempt < max_retries - 1:
                    await asyncio.sleep(1.0)

            self.log(f"  [FOCUS-FAIL] {expected_app} nicht im erwarteten Zustand nach {max_retries} Versuchen")
            return {
                "success": False,
                "detected_app": result.detected_app if 'result' in dir() else "unknown",
                "detected_state": result.detected_state if 'result' in dir() else "unknown",
                "confidence": 0.0,
                "reason": "Max retries reached"
            }

        # Fallback: Simple window title check if no vision available
        self.log(f"  [FOCUS] Vision nicht verfuegbar, nutze Fenster-Titel Check...")
        return await self._validate_app_focus_simple(expected_app, max_retries)

    async def _validate_app_focus_simple(self, expected_app: str, max_retries: int = 3) -> dict:
        """Fallback: Einfache Fenster-Titel Pruefung ohne Vision."""
        # Simple patterns for common apps
        app_patterns = {
            "word": ["word", "document", "dokument"],
            "winword": ["word", "document", "dokument"],
            "excel": ["excel", "book", "mappe"],
            "powerpnt": ["powerpoint", "presentation"],
            "notepad": ["notepad", "editor", "untitled"],
            "chrome": ["chrome", "google"],
            "firefox": ["firefox", "mozilla"],
        }

        patterns = app_patterns.get(expected_app.lower(), [expected_app.lower()])

        for attempt in range(max_retries):
            focus = await self.screen_focus()
            if "error" in focus:
                await asyncio.sleep(0.5)
                continue

            window_title = focus.get("title", "").lower()
            for pattern in patterns:
                if pattern in window_title:
                    return {
                        "success": True,
                        "detected_app": expected_app,
                        "detected_state": "unknown",
                        "confidence": 0.7,
                        "reason": f"Window title matches: {focus.get('title')}"
                    }

            if attempt < max_retries - 1:
                await asyncio.sleep(1.0)

        return {
            "success": False,
            "detected_app": "unknown",
            "detected_state": "unknown",
            "confidence": 0.0,
            "reason": "Window title does not match expected app"
        }

    async def validate_focus(self) -> bool:
        """Validiere ob Focus auf richtigem Screen."""
        focus = await self.screen_focus()

        if "error" in focus:
            self.log(f"  [FAIL] Konnte Focus nicht prüfen")
            return False

        focus_x = focus.get("x", 0)
        focus_screen = focus.get("screen", "unknown")

        if focus_screen == self.current_screen:
            self.log(f"  [OK] Focus korrekt auf {self.current_screen}")
            return True
        else:
            self.log(f"  [FAIL] Focus auf {focus_screen}, erwartet {self.current_screen}")
            return False

    async def set_focus(self) -> bool:
        """Setze Focus auf aktuellen Screen."""
        if self.current_screen == "screen_0":
            x, y = 960, 540
        else:
            x, y = -960, 540

        self.log(f"\n[SET_FOCUS] Klicke auf {self.current_screen} ({x}, {y})")
        await self.action_click(x, y)
        await asyncio.sleep(0.2)
        return await self.validate_focus()

    # ====== SEQUENZEN ======

    # ====== HYBRID EXECUTION ======

    async def execute_direct(self, task_or_match) -> bool:
        """Führt bekanntes Pattern direkt aus (kein Claude CLI).

        Args:
            task_or_match: Entweder ein String (wird gematcht) oder MatchResult

        Returns:
            True wenn erfolgreich, False bei Fehler

        Learning: Jede Aktion wird als ActionRecord gespeichert.
        Input Lock: Mouse/Keyboard werden während Ausführung gesperrt.
        """
        # Accept string or MatchResult
        if isinstance(task_or_match, str):
            match = self.pattern_matcher.match(task_or_match)
            if not match:
                self.log(f"[ERROR] Kein Pattern gefunden: {task_or_match}")
                return False
        else:
            match = task_or_match

        pattern = match.pattern
        params = match.params
        start_time = time.time()
        task_id = f"direct_{pattern}_{int(time.time())}"

        self.log(f"\n{'='*50}")
        self.log(f"[DIRECT] Pattern: {pattern}")
        self.log(f"[PARAMS] {params}")
        self.log(f"{'='*50}")

        def record(tool: str, tool_params: dict, success: bool, duration_ms: float, error: str = None):
            """Helper für Learning Recording."""
            self.record_action(tool, tool_params, success, duration_ms, error)

        # INPUT LOCK: Sperre Mouse/Keyboard während Automation
        if self.input_lock and self.use_input_lock:
            self.input_lock.lock(task_id, timeout_sec=30.0)

        try:
            # ====== OPEN APP ======
            if pattern == "open_app":
                app_cmd = params["cmd"]

                # Track which app we're opening (for app-specific handling)
                if app_cmd == "winword":
                    self._last_opened_app = "word"
                elif app_cmd == "excel":
                    self._last_opened_app = "excel"
                elif app_cmd == "powerpnt":
                    self._last_opened_app = "powerpoint"
                else:
                    self._last_opened_app = app_cmd

                t0 = time.time()
                await self.action_hotkey("win+r")
                record("action_hotkey", {"keys": "win+r"}, True, (time.time()-t0)*1000)

                await asyncio.sleep(0.3)

                t0 = time.time()
                await self.action_type(app_cmd)
                record("action_type", {"text": app_cmd}, True, (time.time()-t0)*1000)

                t0 = time.time()
                await self.action_press("enter")
                record("action_press", {"key": "enter"}, True, (time.time()-t0)*1000)

                await asyncio.sleep(1.5)

                # VISION-BASED FOCUS VALIDATION: Pruefe ob App fokussiert und bereit ist
                focus_result = await self.validate_app_focus_vision(
                    expected_app=self._last_opened_app or app_cmd,
                    expected_state="ready",  # Expect app to be ready for input
                    max_retries=3
                )

                if not focus_result["success"]:
                    self.log(f"  [WARNING] {app_cmd}: {focus_result['reason']}")
                    record("validate_focus", {
                        "app": app_cmd,
                        "detected_app": focus_result["detected_app"],
                        "detected_state": focus_result["detected_state"]
                    }, False, 0, focus_result["reason"])
                else:
                    self.log(f"  [FOCUS-OK] {focus_result['detected_app']} bereit")
                    record("validate_focus", {
                        "app": app_cmd,
                        "detected_app": focus_result["detected_app"],
                        "detected_state": focus_result["detected_state"],
                        "confidence": focus_result["confidence"]
                    }, True, 0)

                # Optional: Additional actions after opening
                if "then_type" in params:
                    await asyncio.sleep(0.5)
                    t0 = time.time()
                    await self.action_type(params["then_type"])
                    record("action_type", {"text": params["then_type"]}, True, (time.time()-t0)*1000)

                if "then_url" in params:
                    await asyncio.sleep(0.5)
                    t0 = time.time()
                    await self.action_hotkey("ctrl+l")
                    record("action_hotkey", {"keys": "ctrl+l"}, True, (time.time()-t0)*1000)

                    await asyncio.sleep(0.2)
                    t0 = time.time()
                    await self.action_type(params["then_url"])
                    record("action_type", {"text": params["then_url"]}, True, (time.time()-t0)*1000)

                    t0 = time.time()
                    await self.action_press("enter")
                    record("action_press", {"key": "enter"}, True, (time.time()-t0)*1000)

            # ====== TYPE TEXT ======
            elif pattern == "type_text":
                t0 = time.time()
                await self.action_type(params["text"])
                record("action_type", {"text": params["text"]}, True, (time.time()-t0)*1000)
                # Track content for validation context
                if self.content_tracker:
                    self.content_tracker.add_typed_text(params["text"])

            # ====== SHORTCUTS ======
            elif pattern == "shortcut":
                action = params["action"]

                # Note: Office start screen handling is now done by validate_app_focus_vision()
                # which runs after open_app and automatically presses Escape if start_screen is detected

                shortcut = self.pattern_matcher.SHORTCUTS.get(action)
                if shortcut:
                    t0 = time.time()
                    await self.action_hotkey(shortcut)
                    record("action_hotkey", {"keys": shortcut, "action": action}, True, (time.time()-t0)*1000)
                    # Track formatting/structure for validation context
                    if self.content_tracker:
                        formatting_actions = ["bold", "italic", "underline", "strikethrough"]
                        structure_actions = ["heading1", "heading2", "heading3", "center", "left", "right", "justify"]
                        if action in formatting_actions:
                            self.content_tracker.add_formatting(action)
                        elif action in structure_actions:
                            self.content_tracker.add_structure(action)
                else:
                    self.log(f"  [ERROR] Unbekannter Shortcut: {action}")
                    record("action_hotkey", {"action": action}, False, 0, f"Unknown shortcut: {action}")
                    return False

            # ====== SAVE AS ======
            elif pattern == "save_as":
                t0 = time.time()
                await self.action_hotkey("ctrl+shift+s")
                record("action_hotkey", {"keys": "ctrl+shift+s"}, True, (time.time()-t0)*1000)

                await asyncio.sleep(0.5)

                t0 = time.time()
                await self.action_type(params["filename"])
                record("action_type", {"text": params["filename"]}, True, (time.time()-t0)*1000)

                t0 = time.time()
                await self.action_press("enter")
                record("action_press", {"key": "enter"}, True, (time.time()-t0)*1000)

            # ====== FIND ======
            elif pattern == "find":
                t0 = time.time()
                await self.action_hotkey("ctrl+f")
                record("action_hotkey", {"keys": "ctrl+f"}, True, (time.time()-t0)*1000)

                await asyncio.sleep(0.3)

                t0 = time.time()
                await self.action_type(params["term"])
                record("action_type", {"text": params["term"]}, True, (time.time()-t0)*1000)

                t0 = time.time()
                await self.action_press("enter")
                record("action_press", {"key": "enter"}, True, (time.time()-t0)*1000)

            # ====== SCROLL ======
            elif pattern == "scroll":
                try:
                    import pyautogui
                    direction = params["direction"]
                    amount = 5 if direction == "down" else -5
                    t0 = time.time()
                    pyautogui.scroll(amount)
                    record("action_scroll", {"direction": direction, "amount": amount}, True, (time.time()-t0)*1000)
                    self.log(f"  [SCROLL] {direction}")
                except Exception as e:
                    record("action_scroll", {"direction": params.get("direction")}, False, 0, str(e))
                    self.log(f"  [ERROR] {e}")
                    return False

            # ====== SCAN ======
            elif pattern == "scan":
                t0 = time.time()
                await self.screen_scan()
                record("screen_scan", {"screen_id": self.current_screen}, True, (time.time()-t0)*1000)

            # ====== WORKFLOW: JOB SCRAPER ======
            elif pattern == "workflow_jobs":
                t0 = time.time()
                self.log(f"\n[WORKFLOW] Job Scraper starting...")
                self.log(f"  URL: {params.get('url')}")
                self.log(f"  Jobs: {params.get('job_count')}")

                try:
                    from workflows.job_scraper_workflow import JobScraperWorkflow

                    workflow = JobScraperWorkflow(mcp_automation=self)
                    result = await workflow.run(
                        url=params.get("url", "https://www.anthropic.com/careers/jobs"),
                        job_count=params.get("job_count", 15),
                        ps_note="the government does not choose the winner"
                    )

                    if result.get("success"):
                        self.log(f"\n[WORKFLOW] Success!")
                        self.log(f"  Jobs: {result.get('jobs', 0)}")
                        self.log(f"  Docs: {result.get('docs', [])}")
                        record("workflow_jobs", params, True, (time.time()-t0)*1000)
                    else:
                        self.log(f"\n[WORKFLOW] Failed: {result.get('error')}")
                        record("workflow_jobs", params, False, (time.time()-t0)*1000, result.get('error'))
                        return False

                except ImportError as e:
                    self.log(f"[ERROR] Workflow not available: {e}")
                    record("workflow_jobs", params, False, (time.time()-t0)*1000, str(e))
                    return False
                except Exception as e:
                    err_msg = str(e).encode('ascii', 'replace').decode('ascii')
                    self.log(f"[ERROR] Workflow failed: {err_msg}")
                    record("workflow_jobs", params, False, (time.time()-t0)*1000, err_msg)
                    return False

            # ====== MOVE WINDOW TO SCREEN ======
            elif pattern == "move_to_screen":
                t0 = time.time()
                window_name = params["window"]
                target_screen = params["screen"]

                screens = get_screens()
                self.log(f"  [SCREENS] Available: {len(screens)}")
                for s in screens:
                    self.log(f"    Screen {s['id']}: {s['width']}x{s['height']} at ({s['x']},{s['y']})")

                success = move_window_to_screen(window_name, target_screen)

                if success:
                    self.log(f"  [MOVED] '{window_name}' -> Screen {target_screen}")
                    record("move_window", params, True, (time.time()-t0)*1000)
                else:
                    self.log(f"  [ERROR] Could not move '{window_name}'")
                    record("move_window", params, False, (time.time()-t0)*1000, "Window not found or move failed")
                    return False

            else:
                self.log(f"  [ERROR] Unbekanntes Pattern: {pattern}")
                record("unknown", {"pattern": pattern}, False, 0, f"Unknown pattern: {pattern}")
                return False

            elapsed = time.time() - start_time
            self.log(f"\n[DIRECT] Fertig in {elapsed:.2f}s")
            return True

        except Exception as e:
            record("error", {"pattern": pattern}, False, (time.time()-start_time)*1000, str(e))
            self.log(f"  [ERROR] {e}")
            return False

        finally:
            # INPUT LOCK: Immer entsperren
            if self.input_lock and self.use_input_lock:
                self.input_lock.unlock()

    async def run_task(self, task: str):
        """Haupteintrittspunkt - entscheidet zwischen Direct und Claude CLI.

        Hybrid-Routing:
        1. Pattern matching versuchen
        2. Wenn Pattern erkannt → direkte Ausführung (schnell)
        3. Wenn nicht erkannt → Claude CLI (intelligent)

        Learning: Jeder Task wird als Episode aufgezeichnet.
        Vision Validation: Before/After Screenshots werden verglichen.
        """
        # Clean task
        clean_task = task.strip()
        if clean_task.startswith("[screen_"):
            if "]>" in clean_task:
                clean_task = clean_task.split("]>", 1)[1].strip()

        # VISION: Capture BEFORE screenshot
        before_screenshot = None
        use_validation = (self.vision_validator and self.use_vision_validation) or \
                        (self.validation_supervisor and self.use_autogen_validation)

        if use_validation and self.vision_validator:
            try:
                before_screenshot = self.vision_validator.capture_screenshot_sync("before")
                self.log(f"[VALIDATION] Before screenshot: {before_screenshot.name}")
            except Exception as e:
                self.log(f"[VALIDATION] Before screenshot failed: {e}")

        # LEARNING: Start episode
        self.start_learning_episode(clean_task)

        # NEW ROUTING LOGIC:
        # 1. Check learned patterns (PatternStore) - fastest, most reliable
        # 2. Check regex patterns (PatternMatcher) - fast, deterministic
        # 3. Estimate complexity (TaskDecomposer) - for routing decision
        # 4. If complex -> LLM Planner (validated execution)
        # 5. Otherwise -> Claude CLI (flexible fallback)

        execution_success = False

        # 1. Check learned patterns first (if available)
        if self.pattern_store:
            learned = await self.find_learned_pattern(clean_task)
            if learned:
                pattern, score = learned
                self.log(f"[ROUTE] LEARNED PATTERN: {pattern.id} (conf={pattern.confidence:.0%})")
                execution_success = await self.execute_learned_pattern(pattern)
                self.add_context(clean_task, "completed" if execution_success else "failed")
                # Skip to validation
                if execution_success or pattern.confidence > 0.9:
                    pass  # Continue to validation
                else:
                    self.log(f"[ROUTE] Pattern failed, trying other routes...")
                    execution_success = False  # Try other routes

        # 2. Check regex patterns
        if not execution_success:
            match = self.pattern_matcher.match(clean_task)

            if match:
                # Bekanntes Pattern → Direkte Ausführung
                self.log(f"[ROUTE] DIRECT (Pattern: {match.pattern})")
                execution_success = await self.execute_direct(match)
                self.add_context(clean_task, "completed" if execution_success else "failed")

            else:
                # 3. Estimate complexity for routing
                if self.task_decomposer and self.smart_mode:
                    complexity = self.task_decomposer.estimate_complexity(clean_task)
                    self.log(f"[ROUTE] Complexity: {complexity['complexity_score']} "
                            f"(subtasks={complexity['total_subtasks']}, unknown={complexity['unknown_subtasks']})")

                    # 4. Complex tasks -> LLM Planner (validated execution)
                    if complexity['total_subtasks'] > self.complexity_threshold or complexity['unknown_subtasks'] > 0:
                        self.log(f"[ROUTE] LLM PLANNER (complex task)")
                        execution_success = await self.run_with_llm_planner(clean_task)
                    else:
                        # 5. Simple unknown -> Claude CLI
                        self.log(f"[ROUTE] CLAUDE CLI (simple unknown)")
                        execution_success = await self.run_claude_task(clean_task)
                else:
                    # No task decomposer -> fallback to Claude CLI
                    self.log(f"[ROUTE] CLAUDE CLI (no pattern match)")
                    execution_success = await self.run_claude_task(clean_task)

        # VALIDATION: Capture AFTER screenshot and validate
        if before_screenshot and use_validation:
            try:
                # Small delay to let UI settle
                await asyncio.sleep(0.5)

                after_screenshot = self.vision_validator.capture_screenshot_sync("after")
                self.log(f"[VALIDATION] After screenshot: {after_screenshot.name}")

                validation = None
                success = False
                reward = 0.0

                # NEW: AutoGen ValidationSupervisor (Round-Robin: Pixel-Diff -> LLM Vision)
                if self.validation_supervisor and self.use_autogen_validation:
                    self.log(f"[VALIDATION] Running AutoGen Supervisor...")
                    # Get content context for LLM
                    content_context = None
                    if self.content_tracker:
                        content_context = self.content_tracker.get_context_summary()
                    validation = await self.validation_supervisor.validate_task(
                        goal=clean_task,
                        before_screenshot=before_screenshot,
                        after_screenshot=after_screenshot,
                        timeout=30.0,
                        content_context=content_context
                    )
                    success = validation.success
                    self.log(f"[VALIDATION] Success: {validation.success} ({validation.confidence:.0%})")
                    self.log(f"[VALIDATION] Method: {validation.validation_method}")
                    self.log(f"[VALIDATION] Reason: {validation.reason}")
                    if validation.observed_changes:
                        self.log(f"[VALIDATION] Changes: {', '.join(validation.observed_changes[:3])}")
                    reward = validation.confidence if validation.success else -validation.confidence

                # FALLBACK: Old Claude CLI Vision Validator
                elif self.vision_validator and self.use_vision_validation:
                    self.log(f"[VALIDATION] Running Claude CLI Vision...")
                    validation = self.vision_validator.validate_success_sync(
                        goal=clean_task,
                        before_screenshot=before_screenshot,
                        after_screenshot=after_screenshot,
                        timeout=60
                    )
                    success = validation.success
                    self.log(f"[VALIDATION] Success: {validation.success} ({validation.confidence:.0%})")
                    self.log(f"[VALIDATION] Reason: {validation.reason}")
                    if validation.observed_changes:
                        self.log(f"[VALIDATION] Changes: {', '.join(validation.observed_changes[:3])}")
                    reward = validation.confidence if validation.success else -validation.confidence

                # LEARNING: End episode with validated result
                if self.memory_collector and self.memory_collector.current_episode:
                    self.memory_collector.end_episode(success=success, reward=reward)

            except Exception as e:
                self.log(f"[VALIDATION] Error: {e}")
                # Fallback to execution success
                self.end_learning_episode(execution_success if isinstance(execution_success, bool) else True)
        else:
            # No validation - use execution success
            self.end_learning_episode(execution_success if isinstance(execution_success, bool) else True)

    def run_claude_task_sync(self, task: str, timeout_sec: int = 60) -> bool:
        """Führe Task mit Claude Worker aus (synchron für Windows).

        Returns:
            True wenn erfolgreich, False bei Fehler

        Learning: Tool-Calls werden für Memory aufgezeichnet.
        Input Lock: Mouse/Keyboard werden während Ausführung gesperrt.
        """
        import subprocess
        import threading
        import signal

        self.log(f"\n{'='*50}")
        self.log(f"CLAUDE TASK: {task[:50]}...")
        self.log(f"Timeout: {timeout_sec}s")
        self.log(f"{'='*50}")

        # INPUT LOCK: Sperre Mouse/Keyboard während Claude CLI läuft
        task_id = f"claude_{int(time.time())}"
        if self.input_lock and self.use_input_lock:
            self.input_lock.lock(task_id, timeout_sec=timeout_sec + 10)

        # Track success and tool calls for learning
        task_success = True
        tool_calls_recorded = []

        # Clean task
        clean_task = task
        if clean_task.startswith("[screen_"):
            if "]>" in clean_task:
                clean_task = clean_task.split("]>", 1)[1].strip()

        # Build step-by-step instructions based on task
        task_lower = clean_task.lower()
        import re

        # Detect task type and build explicit steps
        steps = []
        step_num = 1

        def add_step(instruction):
            nonlocal step_num
            steps.append(f"Step {step_num}: {instruction}")
            step_num += 1

        # ====== OPEN APP PATTERNS ======
        if any(word in task_lower for word in ["open", "oeffne", "offne", "starte", "start"]):
            app_map = {
                "notepad": "notepad", "editor": "notepad",
                "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
                "outlook": "outlook", "onenote": "onenote",
                "chrome": "chrome", "firefox": "firefox", "edge": "msedge",
                "calc": "calc", "rechner": "calc", "calculator": "calc",
                "paint": "mspaint", "terminal": "cmd", "cmd": "cmd",
                "powershell": "powershell", "explorer": "explorer"
            }
            for keyword, app_cmd in app_map.items():
                if keyword in task_lower:
                    add_step("Use mcp__handoff__action_hotkey with keys=win+r")
                    add_step(f"Use mcp__handoff__action_type with text={app_cmd}")
                    add_step("Use mcp__handoff__action_press with key=enter")
                    add_step("Use mcp__handoff__action_sleep with seconds=2")
                    break

            # Check for URL navigation (go to, navigate, gehe zu)
            url_match = re.search(r'(?:go\s*to|navigate\s*to|gehe\s*zu|navigiere\s*zu)\s+(\S+)', task_lower)
            if url_match:
                url = url_match.group(1).strip()
                add_step("Use mcp__handoff__action_hotkey with keys=ctrl+l")  # Focus address bar
                add_step(f"Use mcp__handoff__action_type with text={url}")
                add_step("Use mcp__handoff__action_press with key=enter")
                add_step("Use mcp__handoff__action_sleep with seconds=2")

            # Check for "and type" or "und schreibe"
            type_match = re.search(r'(?:type|schreib[e]?|write)\s+["\']?([^"\']+)["\']?', clean_task, re.IGNORECASE)
            if type_match:
                text_to_type = type_match.group(1).strip()
                add_step(f"Use mcp__handoff__action_type with text={text_to_type}")

        # ====== NEW DOCUMENT ======
        elif any(phrase in task_lower for phrase in ["new doc", "neues dok", "new file", "neue datei"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+n")

        # ====== SAVE PATTERNS ======
        elif any(word in task_lower for word in ["save", "speicher"]):
            if any(word in task_lower for word in ["as", "als", "unter"]):
                # Save As
                add_step("Use mcp__handoff__action_hotkey with keys=ctrl+shift+s")
                # Extract filename if provided
                name_match = re.search(r'(?:as|als|unter)\s+["\']?([^"\']+)["\']?', task_lower)
                if name_match:
                    filename = name_match.group(1).strip()
                    add_step("Use mcp__handoff__action_sleep with seconds=1")
                    add_step(f"Use mcp__handoff__action_type with text={filename}")
                    add_step("Use mcp__handoff__action_press with key=enter")
            else:
                add_step("Use mcp__handoff__action_hotkey with keys=ctrl+s")

        # ====== CLIPBOARD OPERATIONS ======
        elif any(word in task_lower for word in ["copy", "kopier"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+c")

        elif any(word in task_lower for word in ["paste", "einfueg", "einfüg"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+v")

        elif any(word in task_lower for word in ["cut", "ausschneid"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+x")

        # ====== UNDO/REDO ======
        elif any(word in task_lower for word in ["undo", "rueckgaengig", "rückgäng"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+z")

        elif any(word in task_lower for word in ["redo", "wiederhol"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+y")

        # ====== SELECT ALL ======
        elif any(phrase in task_lower for phrase in ["select all", "alles markier", "alles auswaehl"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+a")

        # ====== FIND/SEARCH ======
        elif any(word in task_lower for word in ["find", "such", "search"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+f")
            # Extract search term if provided
            search_match = re.search(r'(?:find|such[e]?|search)\s+(?:for\s+|nach\s+)?["\']?([^"\']+)["\']?', task_lower)
            if search_match:
                search_term = search_match.group(1).strip()
                add_step("Use mcp__handoff__action_sleep with seconds=0.5")
                add_step(f"Use mcp__handoff__action_type with text={search_term}")
                add_step("Use mcp__handoff__action_press with key=enter")

        # ====== FORMAT TEXT ======
        elif any(word in task_lower for word in ["bold", "fett"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+b")

        elif any(word in task_lower for word in ["italic", "kursiv"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+i")

        elif any(word in task_lower for word in ["underline", "unterstreich"]):
            add_step("Use mcp__handoff__action_hotkey with keys=ctrl+u")

        # ====== TYPE TEXT (standalone) ======
        elif any(word in task_lower for word in ["type", "schreib", "write"]):
            type_match = re.search(r'(?:type|schreib[e]?|write)\s+["\']?(.+?)["\']?$', clean_task, re.IGNORECASE)
            if type_match:
                text_to_type = type_match.group(1).strip().strip('"\'')
                add_step(f"Use mcp__handoff__action_type with text={text_to_type}")

        # ====== CLOSE WINDOW ======
        elif any(word in task_lower for word in ["close", "schliess", "beende"]):
            add_step("Use mcp__handoff__action_hotkey with keys=alt+f4")

        # ====== SWITCH WINDOW ======
        elif any(word in task_lower for word in ["switch", "wechsel", "alt-tab", "alttab"]):
            add_step("Use mcp__handoff__action_hotkey with keys=alt+tab")

        # ====== MINIMIZE/MAXIMIZE ======
        elif any(word in task_lower for word in ["minimize", "minimier"]):
            add_step("Use mcp__handoff__action_hotkey with keys=win+down")

        elif any(word in task_lower for word in ["maximize", "maximier"]):
            add_step("Use mcp__handoff__action_hotkey with keys=win+up")

        # ====== SCROLL ======
        elif "scroll" in task_lower:
            if any(word in task_lower for word in ["down", "runter", "unten"]):
                add_step("Use mcp__handoff__action_scroll with direction=down and amount=5")
            elif any(word in task_lower for word in ["up", "hoch", "oben"]):
                add_step("Use mcp__handoff__action_scroll with direction=up and amount=5")

        # ====== SCREEN SCAN ======
        elif any(word in task_lower for word in ["scan", "screenshot", "bildschirm", "screen"]):
            add_step("Use mcp__handoff__screen_scan")

        # ====== CLICK ON ELEMENT ======
        elif any(word in task_lower for word in ["click", "klick"]):
            # Extract target
            click_match = re.search(r'(?:click|klick)\s+(?:on|auf)?\s*["\']?([^"\']+)["\']?', task_lower)
            if click_match:
                target = click_match.group(1).strip()
                add_step(f"Use mcp__handoff__screen_find with text={target}")
                add_step("Use mcp__handoff__action_click using the found coordinates")

        # ====== DEFAULT: Let Claude figure it out ======
        if not steps:
            steps.append(f"Task: {clean_task}")
            steps.append("Use mcp__handoff__ tools to execute this. Available: action_hotkey, action_type, action_press, action_click, action_scroll, screen_scan, screen_find")
            steps.append("Execute the task now using the appropriate tools")

        # Build prompt
        prompt = ". ".join(steps) + ". Execute all steps now."

        cmd = [
            CLAUDE_CLI,
            "-p", prompt,
            "--max-turns", "5",
            "--permission-mode", "bypassPermissions",
            "--output-format", "stream-json",
            "--verbose",
        ]

        if MCP_CONFIG.exists():
            cmd.extend(["--mcp-config", str(MCP_CONFIG)])
            self.log(f"[MCP] Config: {MCP_CONFIG}")
        else:
            self.log(f"[WARN] MCP Config nicht gefunden: {MCP_CONFIG}")
            # Versuche alternatives Verzeichnis
            alt_config = Path(__file__).parent.parent.parent / ".claude" / ".mcp.json"
            if alt_config.exists():
                cmd.extend(["--mcp-config", str(alt_config)])
                self.log(f"[MCP] Alt Config: {alt_config}")

        # Zeige vollen Command
        self.log(f"[CMD] {' '.join(cmd[:6])}...")
        self.log(f"[PROMPT] {prompt}")

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"

        process = None
        try:
            # Synchroner Aufruf mit Popen für Streaming
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(Path(__file__).parent.parent),
                env=env,
                text=True,
                encoding='utf-8',
                errors='replace'
            )

            start_time = time.time()
            line_num = 0
            timed_out = False

            # Lese stdout mit Timeout-Check
            while True:
                # Check timeout
                elapsed = time.time() - start_time
                if elapsed > timeout_sec:
                    self.log(f"\n[TIMEOUT] {timeout_sec}s erreicht, beende Claude...")
                    timed_out = True
                    break

                # Non-blocking check
                if process.poll() is not None:
                    # Process finished
                    break

                line = process.stdout.readline()
                if line:
                    line_num += 1
                    # Parse JSON für bessere Anzeige
                    try:
                        data = json.loads(line.strip())
                        msg_type = data.get('type', '?')

                        if msg_type == 'assistant':
                            # Zeige Tool-Calls
                            msg = data.get('message', {})
                            content = msg.get('content', [])
                            for item in content if isinstance(content, list) else []:
                                if item.get('type') == 'tool_use':
                                    tool = item.get('name', '?')
                                    inp = item.get('input', {})
                                    self.log(f"[TOOL] {tool}({json.dumps(inp)[:80]})")

                                    # LEARNING: Record tool call
                                    tool_calls_recorded.append({
                                        "tool": tool,
                                        "params": inp,
                                        "timestamp": time.time()
                                    })
                                elif item.get('type') == 'text':
                                    text = item.get('text', '')[:100]
                                    if text:
                                        self.log(f"[TEXT] {text}")
                        elif msg_type == 'user':
                            # Tool Result
                            msg = data.get('message', {})
                            content = msg.get('content', [])
                            for item in content if isinstance(content, list) else []:
                                if item.get('type') == 'tool_result':
                                    result = str(item.get('content', ''))[:80]
                                    is_error = item.get('is_error', False)
                                    self.log(f"[RESULT] {result}")

                                    # LEARNING: Mark last tool call with result
                                    if tool_calls_recorded:
                                        tool_calls_recorded[-1]["success"] = not is_error
                                        tool_calls_recorded[-1]["result"] = result

                                    if is_error:
                                        task_success = False
                        elif msg_type == 'system':
                            subtype = data.get('subtype', '')
                            self.log(f"[SYS] {subtype}")
                        elif msg_type == 'result':
                            # Final result
                            self.log(f"[DONE] Turn {data.get('num_turns', '?')}")
                    except json.JSONDecodeError:
                        safe_text = line.strip().encode('ascii', 'replace').decode('ascii')
                        if safe_text:
                            self.log(f"[{line_num:02d}] {safe_text[:150]}")

            # Bei Timeout: Prozess killen
            if timed_out and process.poll() is None:
                self.log("[KILL] Terminiere Claude Prozess...")
                process.kill()
                process.wait(timeout=5)

            # Lese remaining output
            if not timed_out:
                remaining = process.stdout.read()
                if remaining:
                    for line in remaining.strip().split('\n')[:5]:
                        safe = line.encode('ascii', 'replace').decode('ascii')
                        if safe:
                            line_num += 1
                            self.log(f"[Claude:{line_num:02d}] {safe[:120]}")

            # Lese stderr
            stderr = process.stderr.read()
            if stderr:
                self.log(f"[STDERR] {stderr[:200]}")

            exit_code = process.returncode if process.returncode is not None else -1
            self.log(f"\n[Claude] Exit: {exit_code} (nach {time.time()-start_time:.1f}s)")

            if exit_code != 0 and not timed_out:
                self.log("[HINT] Claude braucht evtl. Permissions.")
                self.log("[HINT] Versuche: 'mode direct' für direkten Modus ohne Claude")
                task_success = False

            if timed_out:
                task_success = False

            # LEARNING: Record all tool calls from this Claude session
            for tc in tool_calls_recorded:
                duration = (tc.get("result_time", time.time()) - tc["timestamp"]) * 1000
                self.record_action(
                    tool=tc["tool"],
                    params=tc["params"],
                    success=tc.get("success", True),
                    duration_ms=duration,
                    error=None if tc.get("success", True) else tc.get("result", "Unknown error")
                )

            return task_success

        except FileNotFoundError:
            self.log(f"[ERROR] Claude CLI nicht gefunden: {CLAUDE_CLI}")
            self.log("[HINT] Versuche: 'mode direct' für direkten Modus")
            return False
        except Exception as e:
            self.log(f"[ERROR] {type(e).__name__}: {e}")
            if process and process.poll() is None:
                process.kill()
            return False
        finally:
            # INPUT LOCK: Immer entsperren
            if self.input_lock and self.use_input_lock:
                self.input_lock.unlock()

    async def run_claude_task(self, task: str) -> bool:
        """Wrapper für synchrone Claude Task Ausführung.

        Returns:
            True wenn Task erfolgreich, False bei Fehler
        """
        # Führe synchron aus um Windows asyncio Probleme zu vermeiden
        loop = asyncio.get_event_loop()
        success = await loop.run_in_executor(None, self.run_claude_task_sync, task)

        # Task zum Context hinzufügen
        self.add_context(task, "completed" if success else "failed")
        return success if isinstance(success, bool) else True

    async def parse_natural_language(self, text: str) -> list:
        """Parse natürliche Sprache in Befehle (ohne Claude)."""
        commands = []
        text_lower = text.lower()

        # Einfache Keyword-Erkennung
        if "notepad" in text_lower or "editor" in text_lower:
            commands.append("hotkey win+r")
            commands.append("wait 0.5")
            commands.append("type notepad")
            commands.append("press enter")
            commands.append("wait 1")

        if "word" in text_lower:
            commands.append("hotkey win+r")
            commands.append("wait 0.5")
            commands.append("type winword")
            commands.append("press enter")
            commands.append("wait 2")

        if "docker" in text_lower:
            if "logs" in text_lower:
                # Docker logs holen via shell
                commands.append("shell docker ps --format '{{.Names}}'")
            elif "container" in text_lower or "ps" in text_lower:
                commands.append("shell docker ps")

        if "schreib" in text_lower or "type" in text_lower or "write" in text_lower:
            # Extrahiere Text nach "schreib"
            for marker in ["schreib ", "schreibe ", "type ", "write "]:
                if marker in text_lower:
                    idx = text_lower.find(marker) + len(marker)
                    to_type = text[idx:].strip()
                    if to_type:
                        commands.append(f"type {to_type}")
                    break

        return commands

    def analyze_task_complexity(self, task: str) -> str:
        """Analysiere ob Task lokal oder via Claude ausgeführt werden soll.

        Returns: 'local' oder 'claude'

        LOCAL (direkt ausführen):
        - Explizite Befehle: "click 100 200", "hotkey win+r", "type hello"
        - Shortcut-Keywords: "notepad" (öffnet direkt)

        CLAUDE (LLM entscheidet):
        - Alles andere! Natürliche Sprache wird von Claude interpretiert
        - Claude nutzt dann die MCP Tools (action_hotkey, action_click, etc.)
        """
        task_lower = task.lower().strip()
        first_word = task_lower.split()[0] if task_lower.split() else ""

        # LOCAL: Explizite direkte Befehle (wie in execute_command)
        direct_commands = ["scan", "focus", "click", "type", "hotkey", "press",
                          "find", "wait", "validate", "setfocus", "screen", "shell"]
        if first_word in direct_commands:
            return "local"

        # LOCAL: Shortcut "notepad" (einzelnes Wort)
        if task_lower == "notepad":
            return "local"

        # ALLES ANDERE: Claude entscheidet mit MCP Tools
        return "claude"

    async def run_direct_task(self, task: str):
        """Führe Task direkt ohne Claude aus (Keyword-basiert)."""
        self.log(f"\n{'='*50}")
        self.log(f"DIREKTER TASK: {task[:50]}...")
        self.log(f"{'='*50}")

        commands = await self.parse_natural_language(task)

        if not commands:
            self.log("[WARN] Konnte keine Befehle aus dem Text extrahieren.")
            self.log("Keywords erkannt: notepad, word, docker, schreib...")
            self.log("Beispiel: 'öffne notepad' -> hotkey win+r; type notepad; press enter")
            return

        self.log(f"Erkannte Befehle: {len(commands)}")
        for cmd in commands:
            self.log(f"  -> {cmd}")

        # Focus setzen wenn nötig
        if self.current_screen != "screen_0":
            commands.insert(0, "setfocus")
            commands.insert(1, "validate")

        success = await self.run_sequence(commands)

        # Task zum Context hinzufügen (wie bei run_claude_task)
        self.add_context(task, "completed" if success else "failed")

    async def run_sequence(self, commands: list):
        """Führe Befehlssequenz aus."""
        self.log(f"\n{'='*50}")
        self.log(f"SEQUENZ: {len(commands)} Befehle")
        self.log(f"{'='*50}")

        for i, cmd in enumerate(commands, 1):
            self.log(f"\n--- Schritt {i}/{len(commands)}: {cmd} ---")

            success = await self.execute_command(cmd)
            if not success:
                self.log(f"[ABORT] Sequenz abgebrochen bei Schritt {i}")
                return False

            await asyncio.sleep(0.1)

        self.log(f"\n{'='*50}")
        self.log("SEQUENZ ERFOLGREICH")
        return True

    async def execute_command(self, cmd: str) -> bool:
        """Führe einzelnen Befehl aus."""
        parts = cmd.strip().split(maxsplit=1)
        if not parts:
            return True

        action = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""

        try:
            if action == "scan":
                await self.screen_scan(args if args else None)

            elif action == "focus":
                await self.screen_focus()

            elif action == "click":
                x, y = map(int, args.split())
                await self.action_click(x, y)

            elif action == "type":
                await self.action_type(args)

            elif action == "hotkey":
                await self.action_hotkey(args)

            elif action == "press":
                await self.action_press(args)

            elif action == "find":
                await self.screen_find(args)

            elif action == "wait":
                secs = float(args) if args else 0.5
                self.log(f"[WAIT] {secs}s")
                await asyncio.sleep(secs)

            elif action == "validate":
                if not await self.validate_focus():
                    return False

            elif action == "setfocus":
                if not await self.set_focus():
                    return False

            elif action == "screen":
                self.current_screen = f"screen_{args}" if not args.startswith("screen_") else args
                self.log(f"[SCREEN] {self.current_screen}")

            elif action == "shell":
                self.log(f"[SHELL] {args}")
                try:
                    import subprocess
                    result = subprocess.run(args, shell=True, capture_output=True, text=True, timeout=30)
                    if result.stdout:
                        for line in result.stdout.strip().split('\n')[:20]:
                            self.log(f"  {line}")
                    if result.stderr:
                        self.log(f"[STDERR] {result.stderr[:200]}")
                    return result.returncode == 0
                except Exception as e:
                    self.log(f"[ERROR] {e}")
                    return False

            else:
                self.log(f"[WARN] Unbekannt: {action}")

            return True

        except Exception as e:
            self.log(f"[ERROR] {e}")
            return False


async def main():
    """Interaktive Shell - Hybrid System (Direkt + Claude CLI)."""
    auto = MCPAutomation()

    print("=" * 60)
    print("INTERAKTIVE MCP AUTOMATION - SELF-LEARNING SYSTEM")
    print("=" * 60)
    print(f"Screen: {auto.current_screen}")
    if LEARNING_AVAILABLE and auto.vision_validator:
        v_status = "AN" if auto.use_vision_validation else "AUS"
        print(f"Vision Validation: {v_status}")
    if LEARNING_AVAILABLE and auto.input_lock:
        l_status = "AN" if auto.use_input_lock else "AUS"
        admin = "Admin" if auto.input_lock.status.has_admin else "Soft"
        print(f"Input Lock: {l_status} ({admin})")
    if auto.pattern_store:
        print(f"Patterns Loaded: {len(auto.pattern_store.patterns)}")
    if auto.smart_mode:
        print(f"Smart Mode: AN (LLM Planner fuer komplexe Tasks)")
    print()
    print("SMART ROUTING (Error Rate -> 0):")
    print("  1. Gelernte Patterns  -> SCHNELL (aus Erfahrung)")
    print("  2. Regex Patterns     -> DIREKT (~0.5s)")
    print("  3. Komplexe Tasks     -> LLM PLANNER (validierte Steps)")
    print("  4. Unbekannte Tasks   -> CLAUDE CLI (intelligent)")
    print()
    print("SCHNELLE BEFEHLE (direkt):")
    print("  open notepad       - App oeffnen")
    print("  type Hello World   - Text tippen")
    print("  save / copy / paste / undo")
    print("  bold / italic / close")
    print()
    print("KOMPLEXE BEFEHLE (Claude CLI):")
    print("  finde alle PDFs auf dem Desktop")
    print("  analysiere den Bildschirm")
    print()
    print("WORKFLOWS (Multi-Step Automation):")
    print("  workflow jobs <url>   - Scrape Jobs, Word, Outlook")
    print("  workflow jobs https://anthropic.com/careers/jobs")
    print()
    print("SHELL:")
    print("  shell <cmd>   - Shell-Befehl direkt ausfuehren")
    print()
    print("SESSION:")
    print("  context       - Zeige Session-Context")
    print("  clear         - Loesche Session-Context")
    print("  screen N      - Wechsle Screen")
    print("  quiet/verbose - Output ein/aus")
    print("  quit          - Beenden")
    print()
    if LEARNING_AVAILABLE:
        print("LEARNING:")
        print("  stats         - Zeige Learning Statistiken")
        print("  patterns      - Liste gelernte Patterns")
        print("  smart         - Toggle Smart Mode (LLM Planner)")
        print("  complexity X  - Zeige Komplexitaet von Task X")
        print("  memories      - Zeige gespeicherte App-Memories")
        print("  explore       - Erkunde aktuelle App (UI-Elemente)")
        print("  explore <app> - Erkunde spezifische App")
        print("  apps          - Liste erkundete Apps")
        print("  vision        - Toggle Vision-Validierung (Claude Vision)")
        print("  lock          - Toggle Input-Lock (Mouse/Keyboard sperren)")
    print("-" * 60)

    while True:
        try:
            prompt = f"[{auto.current_screen}]> "
            cmd = input(prompt).strip()

            if not cmd:
                continue

            if cmd.lower() in ("quit", "exit", "q"):
                break

            elif cmd.lower() == "quiet":
                auto.verbose = False
                print("  Output: quiet")

            elif cmd.lower() == "verbose":
                auto.verbose = True
                print("  Output: verbose")

            elif cmd.lower() == "help":
                print(__doc__)

            elif cmd.lower() == "context":
                # Zeige Session-Context
                if auto.session_context:
                    print("\n[SESSION CONTEXT]")
                    for i, ctx in enumerate(auto.session_context, 1):
                        print(f"  {i}. [{ctx['screen']}] {ctx['task']} -> {ctx['result']}")
                else:
                    print("  (leer)")

            elif cmd.lower() == "clear":
                auto.clear_context()
                print("  Session-Context geloescht")

            elif cmd.lower().startswith("screen "):
                screen_num = cmd[7:].strip()
                auto.current_screen = f"screen_{screen_num}" if not screen_num.startswith("screen_") else screen_num
                print(f"  Screen: {auto.current_screen}")

            elif cmd.lower().startswith("shell "):
                # Shell-Befehl direkt ausführen
                shell_cmd = cmd[6:].strip()
                print(f"[SHELL] {shell_cmd}")
                try:
                    import subprocess
                    result = subprocess.run(shell_cmd, shell=True, capture_output=True, text=True, timeout=30)
                    if result.stdout:
                        print(result.stdout)
                    if result.stderr:
                        print(f"[STDERR] {result.stderr}")
                except Exception as e:
                    print(f"[ERROR] {e}")

            elif cmd.lower() == "stats":
                # Learning Statistiken anzeigen
                if LEARNING_AVAILABLE and auto.memory_collector:
                    stats = auto.get_learning_stats()
                    print("\n[LEARNING STATISTICS]")
                    print(f"  Episodes total:     {stats.get('total_episodes', 0)}")
                    print(f"  Successful:         {stats.get('successful_episodes', 0)}")
                    print(f"  Success Rate:       {stats.get('success_rate', 0):.1f}%")
                    print(f"  Total Actions:      {stats.get('total_actions', 0)}")
                    print(f"  Action Success:     {stats.get('action_success_rate', 0):.1f}%")
                    print(f"  Avg Actions/Ep:     {stats.get('avg_actions_per_episode', 0):.1f}")
                    print(f"  Avg Duration:       {stats.get('avg_duration_ms', 0):.0f}ms")
                    print(f"  Apps learned:       {stats.get('apps', [])}")

                # Pattern Learning stats
                if auto.pattern_store:
                    p_stats = auto.get_pattern_stats()
                    print("\n[PATTERN LEARNING]")
                    print(f"  Total Patterns:     {p_stats.get('total_patterns', 0)}")
                    print(f"  Learned:            {p_stats.get('learned_patterns', 0)}")
                    print(f"  Predefined:         {p_stats.get('predefined_patterns', 0)}")
                    print(f"  High Confidence:    {p_stats.get('high_confidence_patterns', 0)}")
                    print(f"  Avg Confidence:     {p_stats.get('avg_confidence', 0):.0%}")
                    print(f"  Total Executions:   {p_stats.get('total_executions', 0)}")

                    if 'planner_stats' in p_stats:
                        pl_stats = p_stats['planner_stats']
                        print("\n[LLM PLANNER]")
                        print(f"  Plans Created:      {pl_stats.get('plans_created', 0)}")
                        print(f"  Plans Completed:    {pl_stats.get('plans_completed', 0)}")
                        print(f"  Plans Failed:       {pl_stats.get('plans_failed', 0)}")
                        print(f"  Success Rate:       {pl_stats.get('success_rate', 0):.0f}%")
                        print(f"  Steps Executed:     {pl_stats.get('steps_executed', 0)}")
                        print(f"  Validation Retries: {pl_stats.get('validation_retries', 0)}")

                if not LEARNING_AVAILABLE:
                    print("  Learning nicht verfuegbar")

            elif cmd.lower() == "patterns":
                # List learned patterns
                if auto.pattern_store:
                    patterns = auto.pattern_store.get_all_patterns()
                    print(f"\n[PATTERNS] {len(patterns)} total")
                    for p in patterns[:20]:
                        status = "OK" if p.confidence >= 0.7 else "LOW"
                        print(f"  [{status}] {p.id}: conf={p.confidence:.0%}, used={p.usage_count}")
                else:
                    print("  Pattern Store nicht verfuegbar")

            elif cmd.lower() == "smart":
                # Toggle smart mode (LLM planner for complex tasks)
                auto.smart_mode = not auto.smart_mode
                print(f"  Smart Mode: {'AN' if auto.smart_mode else 'AUS'}")

            elif cmd.lower().startswith("complexity "):
                # Estimate task complexity
                task_to_check = cmd[11:].strip()
                if auto.task_decomposer:
                    complexity = auto.task_decomposer.estimate_complexity(task_to_check)
                    subtasks = auto.task_decomposer.decompose(task_to_check)
                    print(f"\n[COMPLEXITY] {task_to_check}")
                    print(f"  Total Subtasks:    {complexity['total_subtasks']}")
                    print(f"  Known Subtasks:    {complexity['known_subtasks']}")
                    print(f"  Unknown Subtasks:  {complexity['unknown_subtasks']}")
                    print(f"  Complexity Score:  {complexity['complexity_score']}")
                    print(f"  Can Decompose:     {'Yes' if complexity['can_fully_decompose'] else 'No'}")
                    print(f"\n  Subtasks:")
                    for st in subtasks:
                        print(f"    [{st.index}] {st.type.value}: {st.params}")
                else:
                    print("  Task Decomposer nicht verfuegbar")

            elif cmd.lower() == "memories":
                # App Memories anzeigen
                if LEARNING_AVAILABLE and auto.memory_collector:
                    memory_dir = auto.memory_collector.memory_dir
                    print(f"\n[APP MEMORIES] {memory_dir}")
                    if memory_dir.exists():
                        for app_dir in sorted(memory_dir.iterdir()):
                            if app_dir.is_dir():
                                interactions = app_dir / "interactions.jsonl"
                                count = 0
                                if interactions.exists():
                                    with open(interactions) as f:
                                        count = sum(1 for _ in f)
                                print(f"  {app_dir.name}: {count} episodes")
                    else:
                        print("  (keine Memories)")
                else:
                    print("  Learning nicht verfuegbar")

            elif cmd.lower().startswith("explore"):
                # App Explorer
                if LEARNING_AVAILABLE and auto.app_explorer:
                    parts = cmd.split(maxsplit=1)
                    if len(parts) > 1:
                        # explore <app_name>
                        app_name = parts[1].strip()
                        print(f"\n[EXPLORE] Erkunde App: {app_name}")
                        await auto.explore_app(app_name, open_app=True)
                    else:
                        # explore (aktuelle App)
                        print("\n[EXPLORE] Erkunde aktuelle App...")
                        await auto.explore_app()
                else:
                    print("  App Explorer nicht verfuegbar")

            elif cmd.lower() == "apps":
                # Liste erkundete Apps
                if LEARNING_AVAILABLE and auto.app_explorer:
                    apps = auto.list_explored_apps()
                    print(f"\n[EXPLORED APPS] {len(apps)} Apps")
                    for app in apps:
                        knowledge = auto.app_explorer.load_knowledge(app)
                        if knowledge:
                            print(f"  {app}: {knowledge.total_elements_found} elements, {len(knowledge.shortcuts)} shortcuts")
                        else:
                            print(f"  {app}: (no data)")
                else:
                    print("  App Explorer nicht verfuegbar")

            elif cmd.lower() == "vision":
                # Toggle Vision Validation
                if LEARNING_AVAILABLE and auto.vision_validator:
                    auto.use_vision_validation = not auto.use_vision_validation
                    status = "AN" if auto.use_vision_validation else "AUS"
                    print(f"[VISION] Vision-Validierung: {status}")
                    if auto.use_vision_validation:
                        print("  Before/After Screenshots werden verglichen")
                        print("  Claude Vision bestimmt Task-Erfolg")
                else:
                    print("  Vision Validator nicht verfuegbar")

            elif cmd.lower() == "lock":
                # Toggle Input Lock
                if LEARNING_AVAILABLE and auto.input_lock:
                    auto.use_input_lock = not auto.use_input_lock
                    status = "AN" if auto.use_input_lock else "AUS"
                    admin = "Admin-Modus" if auto.input_lock.status.has_admin else "Soft-Lock"
                    print(f"[INPUT_LOCK] Input-Sperre: {status} ({admin})")
                    if auto.use_input_lock:
                        print("  Mouse/Keyboard werden waehrend Automation gesperrt")
                        if not auto.input_lock.status.has_admin:
                            print("  HINWEIS: Volle Sperrung nur mit Admin-Rechten")
                else:
                    print("  Input Lock nicht verfuegbar")

            else:
                # Hybrid Routing: Direkt für bekannte Patterns, Claude CLI für komplexe Tasks
                await auto.run_task(cmd)

        except KeyboardInterrupt:
            print("\n[Ctrl+C]")
        except EOFError:
            break
        except Exception as e:
            print(f"[ERROR] {e}")

    # Cleanup
    if auto.validation_supervisor:
        await auto.validation_supervisor.close()

    print("\nBye!")


if __name__ == "__main__":
    asyncio.run(main())
