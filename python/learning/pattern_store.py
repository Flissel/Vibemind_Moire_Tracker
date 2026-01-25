"""
Pattern Store - Persistent storage for learned automation patterns.

Provides O(1) lookup for known patterns and confidence-based selection.
Patterns are stored in JSON and loaded into memory for fast access.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from difflib import SequenceMatcher
import hashlib

from .action_step import ActionStep, ActionSequence


@dataclass
class Pattern:
    """
    A learned execution pattern.

    Contains the trigger (what user says) and the actions to execute.
    Tracks success/failure statistics for confidence scoring.
    """
    id: str                                    # Unique ID: "open_notepad_v1"
    trigger: str                               # Original task text
    keywords: List[str] = field(default_factory=list)  # Keywords for matching
    regex_pattern: Optional[str] = None        # Optional regex for matching
    actions: List[ActionStep] = field(default_factory=list)

    # Statistics
    success_count: int = 0
    fail_count: int = 0
    total_duration_ms: float = 0.0
    last_used: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    # Metadata
    source: str = "learned"                    # "learned", "predefined", "user"
    app_context: Optional[str] = None          # Which app this pattern is for

    @property
    def confidence(self) -> float:
        """Calculate confidence score (0-1)."""
        total = self.success_count + self.fail_count
        if total == 0:
            return 0.5  # Unknown, neutral confidence
        return self.success_count / total

    @property
    def avg_duration_ms(self) -> float:
        """Average execution duration."""
        total = self.success_count + self.fail_count
        if total == 0:
            return 0.0
        return self.total_duration_ms / total

    @property
    def usage_count(self) -> int:
        """Total number of times used."""
        return self.success_count + self.fail_count

    def record_execution(self, success: bool, duration_ms: float):
        """Record an execution result."""
        if success:
            self.success_count += 1
        else:
            self.fail_count += 1
        self.total_duration_ms += duration_ms
        self.last_used = datetime.now().isoformat()

    def matches(self, task: str) -> Tuple[bool, float]:
        """
        Check if this pattern matches the given task.

        Returns:
            (matches: bool, score: float) - score is 0-1 match quality
        """
        task_lower = task.lower().strip()
        trigger_lower = self.trigger.lower().strip()

        # 1. Exact match
        if task_lower == trigger_lower:
            return True, 1.0

        # 2. Regex match
        if self.regex_pattern:
            if re.match(self.regex_pattern, task_lower, re.IGNORECASE):
                return True, 0.95

        # 3. Keyword match (all keywords must be present)
        if self.keywords:
            task_words = set(task_lower.split())
            keywords_set = set(kw.lower() for kw in self.keywords)
            if keywords_set.issubset(task_words):
                return True, 0.85

        # 4. Fuzzy match (Levenshtein-like)
        similarity = SequenceMatcher(None, task_lower, trigger_lower).ratio()
        if similarity > 0.8:
            return True, similarity * 0.9  # Scale down slightly

        return False, 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "trigger": self.trigger,
            "keywords": self.keywords,
            "regex_pattern": self.regex_pattern,
            "actions": [a.to_dict() if isinstance(a, ActionStep) else a for a in self.actions],
            "success_count": self.success_count,
            "fail_count": self.fail_count,
            "total_duration_ms": self.total_duration_ms,
            "last_used": self.last_used,
            "created_at": self.created_at,
            "source": self.source,
            "app_context": self.app_context
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Pattern":
        """Create Pattern from dictionary."""
        actions = []
        for a in data.get("actions", []):
            if isinstance(a, dict):
                actions.append(ActionStep.from_dict(a))
            else:
                actions.append(a)

        return cls(
            id=data["id"],
            trigger=data["trigger"],
            keywords=data.get("keywords", []),
            regex_pattern=data.get("regex_pattern"),
            actions=actions,
            success_count=data.get("success_count", 0),
            fail_count=data.get("fail_count", 0),
            total_duration_ms=data.get("total_duration_ms", 0.0),
            last_used=data.get("last_used"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            source=data.get("source", "learned"),
            app_context=data.get("app_context")
        )

    def __str__(self) -> str:
        return f"Pattern({self.id}, conf={self.confidence:.0%}, used={self.usage_count})"


class PatternStore:
    """
    Persistent storage for learned patterns.

    Features:
    - O(1) lookup by ID
    - Keyword-based search
    - Fuzzy matching for similar tasks
    - Confidence-based ranking
    - Automatic persistence to JSON
    """

    def __init__(self, store_path: Optional[Path] = None):
        """
        Initialize PatternStore.

        Args:
            store_path: Path to JSON file. Default: data/patterns.json
        """
        if store_path is None:
            # Default path relative to this file
            base_dir = Path(__file__).parent.parent / "data"
            base_dir.mkdir(parents=True, exist_ok=True)
            store_path = base_dir / "patterns.json"

        self.store_path = Path(store_path)
        self.patterns: Dict[str, Pattern] = {}  # id -> Pattern
        self.keyword_index: Dict[str, List[str]] = {}  # keyword -> [pattern_ids]

        self._load()

    def _load(self):
        """Load patterns from disk."""
        if not self.store_path.exists():
            self._init_predefined_patterns()
            self._save()
            return

        try:
            with open(self.store_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            for pattern_data in data.get("patterns", []):
                pattern = Pattern.from_dict(pattern_data)
                self.patterns[pattern.id] = pattern
                self._index_pattern(pattern)

            print(f"[PatternStore] Loaded {len(self.patterns)} patterns from {self.store_path}")

        except Exception as e:
            print(f"[PatternStore] Error loading: {e}")
            self._init_predefined_patterns()

    def _save(self):
        """Save patterns to disk."""
        try:
            self.store_path.parent.mkdir(parents=True, exist_ok=True)

            data = {
                "version": "1.0",
                "updated_at": datetime.now().isoformat(),
                "pattern_count": len(self.patterns),
                "patterns": [p.to_dict() for p in self.patterns.values()]
            }

            with open(self.store_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

        except Exception as e:
            print(f"[PatternStore] Error saving: {e}")

    def _index_pattern(self, pattern: Pattern):
        """Add pattern to keyword index."""
        for keyword in pattern.keywords:
            kw_lower = keyword.lower()
            if kw_lower not in self.keyword_index:
                self.keyword_index[kw_lower] = []
            if pattern.id not in self.keyword_index[kw_lower]:
                self.keyword_index[kw_lower].append(pattern.id)

    def _init_predefined_patterns(self):
        """Initialize with predefined common patterns."""
        predefined = [
            # App opening patterns
            Pattern(
                id="open_notepad",
                trigger="open notepad",
                keywords=["open", "notepad"],
                regex_pattern=r"^(oeffne|open|starte?)\s+(notepad|editor)$",
                actions=[
                    ActionStep("hotkey", {"keys": "win+r"}, 500),
                    ActionStep("type", {"text": "notepad"}, 100),
                    ActionStep("press", {"key": "enter"}, 2000),
                ],
                source="predefined"
            ),
            Pattern(
                id="open_word",
                trigger="open word",
                keywords=["open", "word"],
                regex_pattern=r"^(oeffne|open|starte?)\s+(word|winword)$",
                actions=[
                    ActionStep("hotkey", {"keys": "win+r"}, 500),
                    ActionStep("type", {"text": "winword"}, 100),
                    ActionStep("press", {"key": "enter"}, 3000),
                ],
                source="predefined",
                app_context="word"
            ),
            Pattern(
                id="open_excel",
                trigger="open excel",
                keywords=["open", "excel"],
                regex_pattern=r"^(oeffne|open|starte?)\s+excel$",
                actions=[
                    ActionStep("hotkey", {"keys": "win+r"}, 500),
                    ActionStep("type", {"text": "excel"}, 100),
                    ActionStep("press", {"key": "enter"}, 3000),
                ],
                source="predefined",
                app_context="excel"
            ),
            Pattern(
                id="open_chrome",
                trigger="open chrome",
                keywords=["open", "chrome"],
                regex_pattern=r"^(oeffne|open|starte?)\s+(chrome|browser)$",
                actions=[
                    ActionStep("hotkey", {"keys": "win+r"}, 500),
                    ActionStep("type", {"text": "chrome"}, 100),
                    ActionStep("press", {"key": "enter"}, 2000),
                ],
                source="predefined",
                app_context="chrome"
            ),
            Pattern(
                id="open_explorer",
                trigger="open explorer",
                keywords=["open", "explorer", "files"],
                regex_pattern=r"^(oeffne|open)\s+(explorer|dateien|files)$",
                actions=[
                    ActionStep("hotkey", {"keys": "win+e"}, 1000),
                ],
                source="predefined",
                app_context="explorer"
            ),
            Pattern(
                id="open_settings",
                trigger="open settings",
                keywords=["open", "settings", "einstellungen"],
                regex_pattern=r"^(oeffne|open)\s+(settings|einstellungen)$",
                actions=[
                    ActionStep("hotkey", {"keys": "win+i"}, 1000),
                ],
                source="predefined"
            ),

            # Document actions
            Pattern(
                id="save_document",
                trigger="save",
                keywords=["save", "speichern"],
                regex_pattern=r"^(speicher[ne]?|save)$",
                actions=[
                    ActionStep("hotkey", {"keys": "ctrl+s"}, 500),
                ],
                source="predefined"
            ),
            Pattern(
                id="copy",
                trigger="copy",
                keywords=["copy", "kopieren"],
                regex_pattern=r"^(kopier[en]?|copy)$",
                actions=[
                    ActionStep("hotkey", {"keys": "ctrl+c"}, 100),
                ],
                source="predefined"
            ),
            Pattern(
                id="paste",
                trigger="paste",
                keywords=["paste", "einfuegen"],
                regex_pattern=r"^(einfuegen|paste)$",
                actions=[
                    ActionStep("hotkey", {"keys": "ctrl+v"}, 100),
                ],
                source="predefined"
            ),
            Pattern(
                id="undo",
                trigger="undo",
                keywords=["undo", "rueckgaengig"],
                regex_pattern=r"^(rueckgaengig|undo)$",
                actions=[
                    ActionStep("hotkey", {"keys": "ctrl+z"}, 100),
                ],
                source="predefined"
            ),
            Pattern(
                id="select_all",
                trigger="select all",
                keywords=["select", "all", "alles", "markieren"],
                regex_pattern=r"^(alles\s+markieren|select\s+all)$",
                actions=[
                    ActionStep("hotkey", {"keys": "ctrl+a"}, 100),
                ],
                source="predefined"
            ),
            Pattern(
                id="new_document",
                trigger="new document",
                keywords=["new", "neu", "document", "dokument"],
                regex_pattern=r"^(neu(es)?\s+(dokument|document)|new\s+doc(ument)?)$",
                actions=[
                    ActionStep("hotkey", {"keys": "ctrl+n"}, 500),
                ],
                source="predefined"
            ),
            Pattern(
                id="close_window",
                trigger="close window",
                keywords=["close", "schliessen"],
                regex_pattern=r"^(schliessen|close)$",
                actions=[
                    ActionStep("hotkey", {"keys": "alt+f4"}, 500),
                ],
                source="predefined"
            ),
        ]

        for pattern in predefined:
            self.patterns[pattern.id] = pattern
            self._index_pattern(pattern)

        print(f"[PatternStore] Initialized {len(predefined)} predefined patterns")

    def find_pattern(self, task: str, min_confidence: float = 0.5) -> Optional[Tuple[Pattern, float]]:
        """
        Find the best matching pattern for a task.

        Args:
            task: The task description
            min_confidence: Minimum pattern confidence to consider

        Returns:
            (Pattern, match_score) or None if no match found
        """
        best_match: Optional[Tuple[Pattern, float]] = None

        for pattern in self.patterns.values():
            # Skip patterns with low confidence
            if pattern.confidence < min_confidence:
                continue

            # Skip patterns with no actions (bad learned patterns)
            if not pattern.actions or len(pattern.actions) == 0:
                continue

            matches, score = pattern.matches(task)
            if matches:
                # Combine match score with pattern confidence
                combined_score = score * pattern.confidence

                if best_match is None or combined_score > best_match[1]:
                    best_match = (pattern, combined_score)

        return best_match

    def learn_pattern(
        self,
        task: str,
        actions: List[ActionStep],
        success: bool,
        duration_ms: float = 0.0,
        app_context: Optional[str] = None
    ) -> Optional[Pattern]:
        """
        Learn a new pattern or update an existing one.

        Args:
            task: The original task text
            actions: The actions that were executed
            success: Whether the execution was successful
            duration_ms: Total execution duration
            app_context: Which app this was for

        Returns:
            The created or updated Pattern, or None if actions is empty
        """
        # VALIDATION: Don't learn patterns with 0 actions
        if not actions or len(actions) == 0:
            print(f"[PatternStore] Skipping pattern learning - no actions provided for: {task[:50]}...")
            return None

        # Check if we already have a similar pattern
        existing = self.find_pattern(task, min_confidence=0.0)

        if existing and existing[1] > 0.9:
            # Update existing pattern
            pattern = existing[0]
            pattern.record_execution(success, duration_ms)
            self._save()
            return pattern

        # Create new pattern
        pattern_id = self._generate_pattern_id(task)
        keywords = self._extract_keywords(task)

        pattern = Pattern(
            id=pattern_id,
            trigger=task,
            keywords=keywords,
            actions=actions,
            success_count=1 if success else 0,
            fail_count=0 if success else 1,
            total_duration_ms=duration_ms,
            last_used=datetime.now().isoformat(),
            source="learned",
            app_context=app_context
        )

        self.patterns[pattern_id] = pattern
        self._index_pattern(pattern)
        self._save()

        print(f"[PatternStore] Learned new pattern: {pattern_id}")
        return pattern

    def _generate_pattern_id(self, task: str) -> str:
        """Generate a unique pattern ID from task text."""
        # Create base from first few words
        words = task.lower().split()[:3]
        base = "_".join(words)
        base = re.sub(r"[^a-z0-9_]", "", base)

        # Add hash suffix for uniqueness
        hash_suffix = hashlib.md5(task.encode()).hexdigest()[:6]

        return f"{base}_{hash_suffix}"

    def _extract_keywords(self, task: str) -> List[str]:
        """Extract keywords from task text."""
        # Remove common stop words
        stop_words = {"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
                      "der", "die", "das", "und", "oder", "in", "auf", "zu", "fuer"}

        words = task.lower().split()
        keywords = [w for w in words if w not in stop_words and len(w) > 2]

        return keywords[:5]  # Limit to 5 keywords

    def get_pattern(self, pattern_id: str) -> Optional[Pattern]:
        """Get pattern by ID."""
        return self.patterns.get(pattern_id)

    def get_all_patterns(self, min_confidence: float = 0.0) -> List[Pattern]:
        """Get all patterns, optionally filtered by confidence."""
        patterns = list(self.patterns.values())
        if min_confidence > 0:
            patterns = [p for p in patterns if p.confidence >= min_confidence]
        return sorted(patterns, key=lambda p: p.confidence, reverse=True)

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the pattern store."""
        patterns = list(self.patterns.values())

        if not patterns:
            return {
                "total_patterns": 0,
                "learned_patterns": 0,
                "predefined_patterns": 0,
                "avg_confidence": 0.0,
                "total_executions": 0
            }

        return {
            "total_patterns": len(patterns),
            "learned_patterns": sum(1 for p in patterns if p.source == "learned"),
            "predefined_patterns": sum(1 for p in patterns if p.source == "predefined"),
            "avg_confidence": sum(p.confidence for p in patterns) / len(patterns),
            "total_executions": sum(p.usage_count for p in patterns),
            "high_confidence_patterns": sum(1 for p in patterns if p.confidence >= 0.8)
        }

    def remove_pattern(self, pattern_id: str) -> bool:
        """Remove a pattern by ID."""
        if pattern_id in self.patterns:
            del self.patterns[pattern_id]
            self._save()
            return True
        return False

    def save(self):
        """Explicitly save to disk."""
        self._save()


if __name__ == "__main__":
    # Test
    print("=== PatternStore Test ===\n")

    # Create store (will init predefined patterns)
    store = PatternStore()

    # Stats
    stats = store.get_stats()
    print(f"Stats: {stats}\n")

    # Find pattern
    test_tasks = [
        "open notepad",
        "oeffne word",
        "save",
        "speichern",
        "copy",
        "open chrome",
        "random unknown task"
    ]

    print("=== Pattern Matching ===")
    for task in test_tasks:
        result = store.find_pattern(task)
        if result:
            pattern, score = result
            print(f"  '{task}' -> {pattern.id} (score={score:.2f}, conf={pattern.confidence:.0%})")
        else:
            print(f"  '{task}' -> No match")

    # Learn a new pattern
    print("\n=== Learning ===")
    new_actions = [
        ActionStep("hotkey", {"keys": "win+r"}, 500),
        ActionStep("type", {"text": "calc"}, 100),
        ActionStep("press", {"key": "enter"}, 1000),
    ]
    pattern = store.learn_pattern("open calculator", new_actions, success=True, duration_ms=1500)
    print(f"Learned: {pattern}")

    # Find the new pattern
    result = store.find_pattern("open calculator")
    if result:
        print(f"Found learned pattern: {result[0].id}")

    # List all patterns
    print("\n=== All Patterns ===")
    for p in store.get_all_patterns():
        print(f"  {p.id}: conf={p.confidence:.0%}, used={p.usage_count}")
