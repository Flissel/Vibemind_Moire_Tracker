"""
VibeMind Learning System

Experience Collection, Pattern Memory, and Neural Policy for Desktop Automation.

Components:
- ActionStep/ActionSequence: Atomic action data structures
- PatternStore: Persistent pattern storage with confidence tracking
- TaskDecomposer: Split complex tasks into subtasks
- MemoryCollector: Record execution episodes
- VisionValidator: Vision-based success validation
"""

# Configure Tesseract path from environment variable
import os
from pathlib import Path

# Load .env if not already loaded
_env_path = Path(__file__).parent.parent.parent / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_path, override=False)
    except ImportError:
        pass

# Configure pytesseract
_tesseract_path = os.getenv("TESSERACT_PATH", "")
if _tesseract_path and Path(_tesseract_path).exists():
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = _tesseract_path
    except ImportError:
        pass
else:
    # Try common Windows paths
    for _path in [
        "C:/Program Files/Tesseract-OCR/tesseract.exe",
        "C:/Program Files (x86)/Tesseract-OCR/tesseract.exe",
    ]:
        if Path(_path).exists():
            try:
                import pytesseract
                pytesseract.pytesseract.tesseract_cmd = _path
                os.environ["TESSERACT_PATH"] = _path
                break
            except ImportError:
                pass

from .memory_collector import MemoryCollector, ActionRecord, EpisodeRecord
from .app_classifier import AppClassifier
from .app_explorer import AppExplorer, AppUIKnowledge, UIElement
from .vision_validator import VisionSuccessValidator, ValidationResult
from .input_lock import InputLock, get_input_lock, lock_input, LockStatus
from .validation_supervisor import (
    ValidationSupervisor,
    ValidationResult as SupervisorValidationResult,
    FocusValidationResult,
    ContentTracker,
    get_content_tracker,
    reset_content_tracker
)

# New self-learning components
from .action_step import (
    ActionStep,
    ActionSequence,
    hotkey,
    type_text,
    press,
    click,
    scroll,
    wait,
    COMMON_SEQUENCES
)
from .pattern_store import Pattern, PatternStore
from .task_decomposer import (
    Subtask,
    SubtaskType,
    TaskDecomposer,
    LearningTaskDecomposer
)
from .llm_task_planner import (
    PlanStep,
    StepStatus,
    ExecutionPlan,
    LLMTaskPlanner,
    plan_and_execute
)

__all__ = [
    # Memory & Recording
    'MemoryCollector',
    'ActionRecord',
    'EpisodeRecord',

    # App Detection
    'AppClassifier',
    'AppExplorer',
    'AppUIKnowledge',
    'UIElement',

    # Validation
    'VisionSuccessValidator',
    'ValidationResult',
    'ValidationSupervisor',
    'SupervisorValidationResult',
    'FocusValidationResult',
    'ContentTracker',
    'get_content_tracker',
    'reset_content_tracker',

    # Input Coordination
    'InputLock',
    'get_input_lock',
    'lock_input',
    'LockStatus',

    # Action Steps
    'ActionStep',
    'ActionSequence',
    'hotkey',
    'type_text',
    'press',
    'click',
    'scroll',
    'wait',
    'COMMON_SEQUENCES',

    # Pattern Learning
    'Pattern',
    'PatternStore',

    # Task Decomposition
    'Subtask',
    'SubtaskType',
    'TaskDecomposer',
    'LearningTaskDecomposer',

    # LLM Task Planning
    'PlanStep',
    'StepStatus',
    'ExecutionPlan',
    'LLMTaskPlanner',
    'plan_and_execute',
]
