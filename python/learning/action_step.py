"""
Action Step - Data structure for automation actions.

Part of the self-learning pattern system. ActionSteps are the atomic
units that make up learned patterns.
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, Any, Optional, List
from datetime import datetime
import json


@dataclass
class ActionStep:
    """
    A single automation action step.

    Examples:
        ActionStep("hotkey", {"keys": "win+r"})
        ActionStep("type", {"text": "notepad"})
        ActionStep("press", {"key": "enter"})
        ActionStep("click", {"x": 100, "y": 200})
    """
    tool: str                          # "hotkey", "type", "press", "click", "scroll"
    params: Dict[str, Any] = field(default_factory=dict)
    delay_ms: int = 100                # Delay after this action
    description: Optional[str] = None  # Human-readable description

    # Execution metadata (filled after execution)
    executed_at: Optional[str] = None
    success: Optional[bool] = None
    error: Optional[str] = None
    duration_ms: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "tool": self.tool,
            "params": self.params,
            "delay_ms": self.delay_ms,
            "description": self.description,
            "executed_at": self.executed_at,
            "success": self.success,
            "error": self.error,
            "duration_ms": self.duration_ms
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ActionStep":
        """Create ActionStep from dictionary."""
        return cls(
            tool=data["tool"],
            params=data.get("params", {}),
            delay_ms=data.get("delay_ms", 100),
            description=data.get("description"),
            executed_at=data.get("executed_at"),
            success=data.get("success"),
            error=data.get("error"),
            duration_ms=data.get("duration_ms")
        )

    def __str__(self) -> str:
        """Human-readable representation."""
        params_str = ", ".join(f"{k}={v!r}" for k, v in self.params.items())
        return f"{self.tool}({params_str})"

    def mark_executed(self, success: bool, duration_ms: float, error: Optional[str] = None):
        """Mark this step as executed with results."""
        self.executed_at = datetime.now().isoformat()
        self.success = success
        self.duration_ms = duration_ms
        self.error = error


@dataclass
class ActionSequence:
    """
    A sequence of ActionSteps that together accomplish a task.

    Example:
        seq = ActionSequence(
            name="open_notepad",
            steps=[
                ActionStep("hotkey", {"keys": "win+r"}),
                ActionStep("type", {"text": "notepad"}),
                ActionStep("press", {"key": "enter"})
            ]
        )
    """
    name: str
    steps: List[ActionStep] = field(default_factory=list)
    description: Optional[str] = None

    # Metadata
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    total_duration_ms: Optional[float] = None
    success: Optional[bool] = None

    def add_step(self, step: ActionStep):
        """Add a step to the sequence."""
        self.steps.append(step)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "steps": [s.to_dict() for s in self.steps],
            "description": self.description,
            "created_at": self.created_at,
            "total_duration_ms": self.total_duration_ms,
            "success": self.success
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ActionSequence":
        """Create ActionSequence from dictionary."""
        return cls(
            name=data["name"],
            steps=[ActionStep.from_dict(s) for s in data.get("steps", [])],
            description=data.get("description"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            total_duration_ms=data.get("total_duration_ms"),
            success=data.get("success")
        )

    def mark_completed(self, success: bool):
        """Mark sequence as completed, calculate total duration."""
        self.success = success
        durations = [s.duration_ms for s in self.steps if s.duration_ms is not None]
        if durations:
            self.total_duration_ms = sum(durations)

    def __len__(self) -> int:
        return len(self.steps)

    def __iter__(self):
        return iter(self.steps)

    def __str__(self) -> str:
        steps_str = " -> ".join(str(s) for s in self.steps)
        return f"{self.name}: [{steps_str}]"


# Common action step factories
def hotkey(keys: str, delay_ms: int = 300) -> ActionStep:
    """Create a hotkey action step."""
    return ActionStep("hotkey", {"keys": keys}, delay_ms, f"Press {keys}")


def type_text(text: str, delay_ms: int = 100) -> ActionStep:
    """Create a type action step."""
    return ActionStep("type", {"text": text}, delay_ms, f"Type '{text[:20]}...' " if len(text) > 20 else f"Type '{text}'")


def press(key: str, delay_ms: int = 100) -> ActionStep:
    """Create a key press action step."""
    return ActionStep("press", {"key": key}, delay_ms, f"Press {key}")


def click(x: int, y: int, button: str = "left", delay_ms: int = 200) -> ActionStep:
    """Create a click action step."""
    return ActionStep("click", {"x": x, "y": y, "button": button}, delay_ms, f"Click at ({x}, {y})")


def scroll(direction: str, amount: int = 3, delay_ms: int = 200) -> ActionStep:
    """Create a scroll action step."""
    return ActionStep("scroll", {"direction": direction, "amount": amount}, delay_ms, f"Scroll {direction} {amount}")


def wait(seconds: float) -> ActionStep:
    """Create a wait/sleep action step."""
    return ActionStep("sleep", {"seconds": seconds}, 0, f"Wait {seconds}s")


# Pre-defined common sequences
COMMON_SEQUENCES = {
    "open_run_dialog": ActionSequence(
        name="open_run_dialog",
        description="Open Windows Run dialog",
        steps=[hotkey("win+r", delay_ms=500)]
    ),
    "copy": ActionSequence(
        name="copy",
        description="Copy to clipboard",
        steps=[hotkey("ctrl+c", delay_ms=100)]
    ),
    "paste": ActionSequence(
        name="paste",
        description="Paste from clipboard",
        steps=[hotkey("ctrl+v", delay_ms=100)]
    ),
    "save": ActionSequence(
        name="save",
        description="Save current document",
        steps=[hotkey("ctrl+s", delay_ms=500)]
    ),
    "undo": ActionSequence(
        name="undo",
        description="Undo last action",
        steps=[hotkey("ctrl+z", delay_ms=100)]
    ),
    "select_all": ActionSequence(
        name="select_all",
        description="Select all content",
        steps=[hotkey("ctrl+a", delay_ms=100)]
    ),
}


if __name__ == "__main__":
    # Test
    print("=== ActionStep Test ===\n")

    # Create a sequence
    seq = ActionSequence(
        name="open_notepad",
        description="Open Notepad via Run dialog",
        steps=[
            hotkey("win+r", delay_ms=500),
            type_text("notepad"),
            press("enter", delay_ms=2000)
        ]
    )

    print(f"Sequence: {seq}")
    print(f"Steps: {len(seq)}")

    # Serialize
    json_str = json.dumps(seq.to_dict(), indent=2)
    print(f"\nJSON:\n{json_str}")

    # Deserialize
    restored = ActionSequence.from_dict(json.loads(json_str))
    print(f"\nRestored: {restored}")

    # Common sequences
    print("\n=== Common Sequences ===")
    for name, common_seq in COMMON_SEQUENCES.items():
        print(f"  {name}: {common_seq}")
