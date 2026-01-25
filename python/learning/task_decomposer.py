"""
Task Decomposer - Split complex tasks into manageable subtasks.

Breaks down natural language tasks into atomic operations that can be:
1. Matched against learned patterns
2. Executed sequentially
3. Have their results tracked independently
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Tuple
from enum import Enum


class SubtaskType(Enum):
    """Types of subtasks."""
    OPEN_APP = "open_app"
    TYPE_TEXT = "type_text"
    KEYBOARD_ACTION = "keyboard_action"
    NAVIGATE = "navigate"
    INTERACT = "interact"
    WAIT = "wait"
    UNKNOWN = "unknown"


@dataclass
class Subtask:
    """A decomposed subtask."""
    description: str              # Human-readable description
    type: SubtaskType            # Type of subtask
    params: Dict[str, Any] = field(default_factory=dict)
    original_text: str = ""      # Original text this was extracted from
    index: int = 0               # Position in sequence
    depends_on: Optional[int] = None  # Index of subtask this depends on

    # Execution state
    pattern_id: Optional[str] = None  # Matched pattern ID
    executed: bool = False
    success: Optional[bool] = None

    def __str__(self) -> str:
        params_str = ", ".join(f"{k}={v!r}" for k, v in self.params.items())
        return f"Subtask({self.type.value}: {params_str})"


class TaskDecomposer:
    """
    Decomposes complex tasks into subtasks.

    Supports:
    - Conjunction splitting ("und", "and", "then", "danach")
    - Intent detection (open, type, save, etc.)
    - Parameter extraction (app names, text, etc.)
    """

    # Conjunctions that separate tasks
    CONJUNCTIONS = [
        r"\s+und\s+dann\s+",
        r"\s+und\s+danach\s+",
        r"\s+danach\s+",
        r"\s+dann\s+",
        r"\s+und\s+",
        r"\s+and\s+then\s+",
        r"\s+then\s+",
        r"\s+and\s+",
        r"\s*,\s+dann\s+",
        r"\s*,\s+",
    ]

    # Intent patterns
    INTENT_PATTERNS = {
        SubtaskType.OPEN_APP: [
            r"^(oeffne|open|starte?|launch)\s+(.+)$",
            r"^(.+)\s+(oeffnen|starten|open)$",
        ],
        SubtaskType.TYPE_TEXT: [
            r'^schreib[e]?\s+"([^"]+)"',
            r"^schreib[e]?\s+(.+)$",
            r'^type\s+"([^"]+)"',
            r"^type\s+(.+)$",
            r'^tippe?\s+"([^"]+)"',
            r"^tippe?\s+(.+)$",
        ],
        SubtaskType.KEYBOARD_ACTION: [
            r"^(speicher[ne]?|save)(\s+als\s+(.+))?$",
            r"^(kopier[en]?|copy)$",
            r"^(einfuegen|paste)$",
            r"^(rueckgaengig|undo)$",
            r"^(neu(es)?\s+(dokument|document)|new\s+doc(ument)?)$",
            r"^(schliessen|close)$",
            r"^(alles\s+markieren|select\s+all)$",
        ],
        SubtaskType.NAVIGATE: [
            r"^(gehe?\s+zu|go\s+to|navigate\s+to)\s+(.+)$",
            r"^(oeffne|open)\s+(https?://\S+)$",
        ],
        SubtaskType.WAIT: [
            r"^(warte?|wait)\s+(\d+)\s*(sekunden?|seconds?|s)?$",
        ],
        SubtaskType.INTERACT: [
            r"^(klick[e]?\s+auf|click\s+on|click)\s+(.+)$",
            r"^(scroll[e]?\s+)(nach\s+)?(unten|down|oben|up)$",
        ],
    }

    # App name normalization
    APP_ALIASES = {
        "word": "word",
        "winword": "word",
        "microsoft word": "word",
        "excel": "excel",
        "microsoft excel": "excel",
        "notepad": "notepad",
        "editor": "notepad",
        "chrome": "chrome",
        "google chrome": "chrome",
        "browser": "chrome",
        "firefox": "firefox",
        "mozilla firefox": "firefox",
        "edge": "edge",
        "microsoft edge": "edge",
        "explorer": "explorer",
        "dateien": "explorer",
        "files": "explorer",
        "datei-explorer": "explorer",
        "einstellungen": "settings",
        "settings": "settings",
        "rechner": "calculator",
        "calculator": "calculator",
        "calc": "calculator",
        "outlook": "outlook",
        "mail": "outlook",
        "teams": "teams",
        "terminal": "terminal",
        "cmd": "terminal",
        "powershell": "powershell",
        "paint": "paint",
    }

    def decompose(self, task: str) -> List[Subtask]:
        """
        Decompose a complex task into subtasks.

        Args:
            task: Natural language task description

        Returns:
            List of Subtask objects in execution order

        Example:
            "oeffne word und schreibe hello und speichere"
            -> [
                Subtask(OPEN_APP, app="word"),
                Subtask(TYPE_TEXT, text="hello"),
                Subtask(KEYBOARD_ACTION, action="save")
            ]
        """
        # Normalize input
        task = task.strip()
        if not task:
            return []

        # Split by conjunctions
        parts = self._split_by_conjunctions(task)

        # Parse each part
        subtasks = []
        for i, part in enumerate(parts):
            part = part.strip()
            if not part:
                continue

            subtask = self._parse_subtask(part, index=i)
            subtask.original_text = part

            # Set dependency on previous subtask (simple linear dependency)
            if i > 0:
                subtask.depends_on = i - 1

            subtasks.append(subtask)

        return subtasks

    def _split_by_conjunctions(self, task: str) -> List[str]:
        """Split task text by conjunctions."""
        parts = [task]

        for conj_pattern in self.CONJUNCTIONS:
            new_parts = []
            for part in parts:
                split = re.split(conj_pattern, part, flags=re.IGNORECASE)
                new_parts.extend(split)
            parts = new_parts

        return [p.strip() for p in parts if p.strip()]

    def _parse_subtask(self, text: str, index: int = 0) -> Subtask:
        """Parse a single subtask from text."""
        text_lower = text.lower().strip()

        # Try each intent pattern
        for subtask_type, patterns in self.INTENT_PATTERNS.items():
            for pattern in patterns:
                match = re.match(pattern, text_lower, re.IGNORECASE)
                if match:
                    params = self._extract_params(subtask_type, match, text)
                    return Subtask(
                        description=text,
                        type=subtask_type,
                        params=params,
                        index=index
                    )

        # No pattern matched - return as unknown
        return Subtask(
            description=text,
            type=SubtaskType.UNKNOWN,
            params={"raw_text": text},
            index=index
        )

    def _extract_params(self, subtask_type: SubtaskType, match: re.Match, original: str) -> Dict[str, Any]:
        """Extract parameters from regex match."""
        params = {}

        if subtask_type == SubtaskType.OPEN_APP:
            # Get app name from match groups
            groups = match.groups()
            app_raw = groups[-1] if groups else original
            app_raw = app_raw.strip().lower()

            # Normalize app name
            app = self.APP_ALIASES.get(app_raw, app_raw)
            params["app"] = app
            params["app_raw"] = app_raw

        elif subtask_type == SubtaskType.TYPE_TEXT:
            groups = match.groups()
            text = groups[0] if groups else original
            params["text"] = text

        elif subtask_type == SubtaskType.KEYBOARD_ACTION:
            groups = match.groups()
            action_text = groups[0].lower() if groups else original.lower()

            # Map to action
            action_map = {
                "speichern": "save", "speicher": "save", "save": "save",
                "kopieren": "copy", "kopier": "copy", "copy": "copy",
                "einfuegen": "paste", "paste": "paste",
                "rueckgaengig": "undo", "undo": "undo",
                "neu": "new", "neues": "new", "new": "new",
                "schliessen": "close", "close": "close",
                "alles": "select_all", "select": "select_all",
            }

            for key, action in action_map.items():
                if key in action_text:
                    params["action"] = action
                    break
            else:
                params["action"] = "unknown"

            # Check for save_as
            if "als" in original.lower() or "as" in original.lower():
                # Extract filename after "als" or "as"
                save_as_match = re.search(r"(?:als|as)\s+(.+)$", original, re.IGNORECASE)
                if save_as_match:
                    params["action"] = "save_as"
                    params["filename"] = save_as_match.group(1).strip()

        elif subtask_type == SubtaskType.NAVIGATE:
            groups = match.groups()
            url = groups[-1] if groups else ""
            params["url"] = url

        elif subtask_type == SubtaskType.WAIT:
            groups = match.groups()
            try:
                seconds = int(groups[1]) if len(groups) > 1 else 1
            except:
                seconds = 1
            params["seconds"] = seconds

        elif subtask_type == SubtaskType.INTERACT:
            groups = match.groups()
            if "click" in match.group(0).lower() or "klick" in match.group(0).lower():
                target = groups[-1] if groups else ""
                params["action"] = "click"
                params["target"] = target.strip()
            elif "scroll" in match.group(0).lower():
                direction = "down"
                if "oben" in original.lower() or "up" in original.lower():
                    direction = "up"
                params["action"] = "scroll"
                params["direction"] = direction

        return params

    def estimate_complexity(self, task: str) -> Dict[str, Any]:
        """
        Estimate the complexity of a task.

        Returns:
            Dict with complexity metrics
        """
        subtasks = self.decompose(task)

        unknown_count = sum(1 for s in subtasks if s.type == SubtaskType.UNKNOWN)
        known_count = len(subtasks) - unknown_count

        return {
            "total_subtasks": len(subtasks),
            "known_subtasks": known_count,
            "unknown_subtasks": unknown_count,
            "complexity_score": len(subtasks) + (unknown_count * 2),  # Unknown adds more complexity
            "can_fully_decompose": unknown_count == 0,
            "subtask_types": [s.type.value for s in subtasks]
        }


class LearningTaskDecomposer(TaskDecomposer):
    """
    TaskDecomposer with pattern store integration.

    Checks each subtask against learned patterns for faster execution.
    """

    def __init__(self, pattern_store=None):
        """
        Initialize with optional pattern store.

        Args:
            pattern_store: PatternStore instance for pattern matching
        """
        super().__init__()
        self.pattern_store = pattern_store

    def decompose_and_match(self, task: str, min_confidence: float = 0.5) -> List[Subtask]:
        """
        Decompose task and match subtasks against patterns.

        Args:
            task: Natural language task
            min_confidence: Minimum pattern confidence to accept

        Returns:
            List of Subtasks with pattern_id set if match found
        """
        subtasks = self.decompose(task)

        if self.pattern_store is None:
            return subtasks

        for subtask in subtasks:
            # Try to find a matching pattern
            result = self.pattern_store.find_pattern(subtask.description, min_confidence)

            if result:
                pattern, score = result
                subtask.pattern_id = pattern.id
                print(f"[Decomposer] Subtask '{subtask.description}' -> Pattern '{pattern.id}' (score={score:.2f})")

        return subtasks


if __name__ == "__main__":
    # Test
    print("=== TaskDecomposer Test ===\n")

    decomposer = TaskDecomposer()

    test_tasks = [
        "oeffne word",
        "oeffne word und schreibe test",
        "oeffne word und schreibe hello und speichere",
        "open chrome and go to google.com",
        'schreibe "Hallo Welt"',
        "oeffne notepad, dann schreibe test, danach speichere als test.txt",
        "kopieren und einfuegen",
        "warte 5 sekunden",
        "klick auf den submit button",
        "scroll nach unten",
        "something completely random and unknown",
    ]

    for task in test_tasks:
        print(f"\nTask: '{task}'")
        subtasks = decomposer.decompose(task)
        for st in subtasks:
            print(f"  [{st.index}] {st.type.value}: {st.params}")

        # Complexity
        complexity = decomposer.estimate_complexity(task)
        print(f"  Complexity: {complexity['complexity_score']} (known={complexity['known_subtasks']}, unknown={complexity['unknown_subtasks']})")

    # Test with PatternStore
    print("\n\n=== LearningTaskDecomposer Test ===")
    try:
        from .pattern_store import PatternStore
        store = PatternStore()
        learning_decomposer = LearningTaskDecomposer(store)

        task = "oeffne word und schreibe hello und speichere"
        print(f"\nTask: '{task}'")
        subtasks = learning_decomposer.decompose_and_match(task)
        for st in subtasks:
            pattern_info = f" -> Pattern: {st.pattern_id}" if st.pattern_id else " -> No pattern"
            print(f"  [{st.index}] {st.type.value}: {st.params}{pattern_info}")

    except ImportError as e:
        print(f"Could not test with PatternStore: {e}")
