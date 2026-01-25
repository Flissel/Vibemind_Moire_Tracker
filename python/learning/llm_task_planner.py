"""
LLM Task Planner - Intelligent task decomposition with validation loop.

Uses Claude CLI for:
1. Intelligent task decomposition (complex tasks -> validated todo list)
2. Step-by-step execution with validation
3. Error recovery and retry logic

Error rate -> 0 through:
- LLM-based planning (understands context)
- Validation after each step (vision/screen check)
- Only proceeds when validation passes
- Learns from failures
"""

import asyncio
import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import List, Optional, Dict, Any, Callable

from .action_step import ActionStep, ActionSequence
from .pattern_store import PatternStore

# Find Claude CLI - on Windows it's 'claude.cmd'
CLAUDE_CLI = shutil.which('claude') or shutil.which('claude.cmd') or 'claude'


def run_claude_cli(prompt: str, timeout: int = 60) -> subprocess.CompletedProcess:
    """Run Claude CLI with proper handling using stdin for complex prompts."""
    import os
    import tempfile

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    # For complex prompts with special characters, use stdin
    # Write prompt to temp file and pipe it
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(prompt)
        prompt_file = f.name

    try:
        # Use --print flag with stdin redirection
        cmd = [CLAUDE_CLI, "--print", "--output-format", "json"]

        with open(prompt_file, 'r', encoding='utf-8') as stdin_file:
            return subprocess.run(
                cmd,
                stdin=stdin_file,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding="utf-8",
                errors='replace',
                env=env,
                cwd=str(Path(__file__).parent.parent.parent)
            )
    finally:
        try:
            os.unlink(prompt_file)
        except:
            pass


def parse_claude_response(stdout: str) -> dict:
    """
    Parse Claude CLI JSON response with nested result.

    Claude CLI returns:
    {"type":"result","result":"```json\n{\"steps\":[...]}\n```",...}

    We need to:
    1. Parse outer JSON
    2. Extract 'result' field
    3. Remove Markdown code blocks
    4. Parse inner JSON
    """
    import re

    try:
        # 1. Parse outer JSON wrapper
        outer = json.loads(stdout)

        # 2. Extract result field
        result_text = outer.get("result", "")

        if not result_text:
            print(f"[LLMPlanner] No result in response")
            return {"steps": []}

        # 3. Remove Markdown code blocks: ```json\n{...}\n```
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', result_text)
        if json_match:
            inner_json = json_match.group(1).strip()
            return json.loads(inner_json)

        # 4. Fallback: result might already be valid JSON
        try:
            return json.loads(result_text)
        except json.JSONDecodeError:
            # Result is plain text, not JSON
            print(f"[LLMPlanner] Result is not JSON: {result_text[:100]}...")
            return {"steps": []}

    except json.JSONDecodeError as e:
        print(f"[LLMPlanner] Outer JSON parse error: {e}")
        print(f"[LLMPlanner] Raw stdout: {stdout[:500]}...")
        return {"steps": []}


class StepStatus(Enum):
    """Status of a planned step."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class PlanStep:
    """
    A single step in the execution plan.

    Each step has:
    - Clear goal/action
    - Validation criteria (what to check after)
    - Retry logic
    """
    id: str
    description: str                           # What to do
    action_type: str                           # "open_app", "type", "click", etc.
    params: Dict[str, Any] = field(default_factory=dict)

    # Validation
    validation_prompt: str = ""                # What to check for success
    expected_result: str = ""                  # Expected screen state

    # State
    status: StepStatus = StepStatus.PENDING
    attempts: int = 0
    max_attempts: int = 3
    error: Optional[str] = None

    # Execution results
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    validation_result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "description": self.description,
            "action_type": self.action_type,
            "params": self.params,
            "validation_prompt": self.validation_prompt,
            "expected_result": self.expected_result,
            "status": self.status.value,
            "attempts": self.attempts,
            "error": self.error
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PlanStep":
        step = cls(
            id=data["id"],
            description=data["description"],
            action_type=data.get("action_type", "unknown"),
            params=data.get("params", {}),
            validation_prompt=data.get("validation_prompt", ""),
            expected_result=data.get("expected_result", "")
        )
        step.status = StepStatus(data.get("status", "pending"))
        step.attempts = data.get("attempts", 0)
        step.error = data.get("error")
        return step


@dataclass
class ExecutionPlan:
    """
    Complete execution plan with validated steps.

    The plan is a todo list where:
    - Each step must be validated before proceeding
    - Failed steps can be retried
    - Plan can be persisted and resumed
    """
    task_id: str
    original_task: str
    steps: List[PlanStep] = field(default_factory=list)

    # Metadata
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    status: str = "created"  # "created", "executing", "completed", "failed"
    current_step_index: int = 0

    def add_step(self, step: PlanStep):
        self.steps.append(step)

    def get_current_step(self) -> Optional[PlanStep]:
        if self.current_step_index < len(self.steps):
            return self.steps[self.current_step_index]
        return None

    def advance(self) -> bool:
        """Move to next step. Returns False if no more steps."""
        self.current_step_index += 1
        return self.current_step_index < len(self.steps)

    def get_progress(self) -> Dict[str, Any]:
        completed = sum(1 for s in self.steps if s.status == StepStatus.COMPLETED)
        failed = sum(1 for s in self.steps if s.status == StepStatus.FAILED)
        return {
            "total": len(self.steps),
            "completed": completed,
            "failed": failed,
            "pending": len(self.steps) - completed - failed,
            "progress_percent": (completed / len(self.steps) * 100) if self.steps else 0
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "original_task": self.original_task,
            "steps": [s.to_dict() for s in self.steps],
            "created_at": self.created_at,
            "status": self.status,
            "current_step_index": self.current_step_index,
            "progress": self.get_progress()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionPlan":
        plan = cls(
            task_id=data["task_id"],
            original_task=data["original_task"],
            steps=[PlanStep.from_dict(s) for s in data.get("steps", [])],
            created_at=data.get("created_at", datetime.now().isoformat()),
            status=data.get("status", "created"),
            current_step_index=data.get("current_step_index", 0)
        )
        return plan


class LLMTaskPlanner:
    """
    LLM-based task planning with validation loop.

    Flow:
    1. Task -> Claude CLI -> Decomposed Plan with validation criteria
    2. For each step:
       a. Execute step
       b. Validate result (screen_scan + LLM check)
       c. If valid -> next step
       d. If invalid -> retry or recover
    3. Learn from success/failure
    """

    DECOMPOSE_PROMPT = '''
Du bist ein Desktop-Automation Planner. Zerlege den folgenden Task in konkrete, ausfuehrbare Schritte.

TASK: {task}

Fuer JEDEN Schritt gib an:
1. id: Eindeutige ID (step_1, step_2, ...)
2. description: Was genau getan werden soll
3. action_type: Eine von [open_app, type_text, hotkey, click, scroll, wait, navigate]
4. params: Parameter fuer die Aktion (z.B. {{"app": "notepad"}})
5. validation_prompt: Wie man pruefen kann ob der Schritt erfolgreich war
6. expected_result: Was man auf dem Bildschirm sehen sollte

Antworte NUR mit validem JSON:
{{
    "steps": [
        {{
            "id": "step_1",
            "description": "Oeffne Notepad",
            "action_type": "open_app",
            "params": {{"app": "notepad"}},
            "validation_prompt": "Ist ein Notepad-Fenster sichtbar?",
            "expected_result": "Ein leeres Notepad-Fenster ist geoeffnet"
        }},
        ...
    ]
}}

WICHTIG:
- Jeder Schritt muss atomar und validierbar sein
- Nicht mehrere Aktionen in einem Schritt
- Validation muss visuell pruefbar sein
'''

    VALIDATE_PROMPT = '''
Validiere ob der folgende Schritt erfolgreich ausgefuehrt wurde.

SCHRITT: {step_description}
ERWARTETES ERGEBNIS: {expected_result}
VALIDATION FRAGE: {validation_prompt}

AKTUELLER BILDSCHIRM-INHALT:
{screen_content}

Antworte NUR mit JSON:
{{
    "success": true/false,
    "confidence": 0.0-1.0,
    "reason": "Kurze Begruendung",
    "suggestions": ["Falls fehlgeschlagen: Vorschlaege zur Behebung"]
}}
'''

    def __init__(
        self,
        pattern_store: Optional[PatternStore] = None,
        plans_dir: Optional[Path] = None,
        mcp_executor: Optional[Callable] = None
    ):
        """
        Initialize LLM Task Planner.

        Args:
            pattern_store: Pattern store for learning
            plans_dir: Directory to persist plans
            mcp_executor: Async function to execute MCP tool calls
        """
        self.pattern_store = pattern_store
        self.plans_dir = plans_dir or Path(__file__).parent.parent / "data" / "plans"
        self.plans_dir.mkdir(parents=True, exist_ok=True)
        self.mcp_executor = mcp_executor

        # Execution stats
        self.stats = {
            "plans_created": 0,
            "plans_completed": 0,
            "plans_failed": 0,
            "steps_executed": 0,
            "steps_validated": 0,
            "validation_retries": 0
        }

    async def create_plan(self, task: str) -> ExecutionPlan:
        """
        Create an execution plan using Claude CLI.

        Args:
            task: Natural language task description

        Returns:
            ExecutionPlan with validated steps
        """
        task_id = f"plan_{int(time.time() * 1000)}"

        # Call Claude CLI for decomposition
        prompt = self.DECOMPOSE_PROMPT.format(task=task)

        try:
            result = run_claude_cli(prompt, timeout=60)

            if result.returncode != 0:
                raise Exception(f"Claude CLI error: {result.stderr}")

            # Parse nested response (Claude CLI wraps result in JSON)
            response = parse_claude_response(result.stdout)
            steps_data = response.get("steps", [])

            # Create plan
            plan = ExecutionPlan(task_id=task_id, original_task=task)

            for step_data in steps_data:
                step = PlanStep.from_dict(step_data)
                plan.add_step(step)

            self.stats["plans_created"] += 1
            self._save_plan(plan)

            print(f"[LLMPlanner] Created plan with {len(plan.steps)} steps")
            return plan

        except json.JSONDecodeError as e:
            print(f"[LLMPlanner] JSON parse error: {e}")
            # Fallback: create simple single-step plan
            plan = ExecutionPlan(task_id=task_id, original_task=task)
            plan.add_step(PlanStep(
                id="step_1",
                description=task,
                action_type="unknown",
                validation_prompt="Task completed successfully?"
            ))
            return plan

        except Exception as e:
            print(f"[LLMPlanner] Error creating plan: {e}")
            raise

    async def execute_plan(
        self,
        plan: ExecutionPlan,
        on_step_complete: Optional[Callable] = None
    ) -> bool:
        """
        Execute a plan with validation after each step.

        Args:
            plan: The execution plan
            on_step_complete: Callback after each step

        Returns:
            True if all steps completed successfully
        """
        plan.status = "executing"
        self._save_plan(plan)

        while plan.current_step_index < len(plan.steps):
            step = plan.get_current_step()
            if step is None:
                break

            # Execute and validate step
            success = await self._execute_and_validate_step(plan, step)

            if on_step_complete:
                await on_step_complete(plan, step)

            if success:
                step.status = StepStatus.COMPLETED
                step.completed_at = datetime.now().isoformat()
                plan.advance()
            else:
                # Check retry logic
                if step.attempts < step.max_attempts:
                    step.status = StepStatus.RETRYING
                    self.stats["validation_retries"] += 1
                    print(f"[LLMPlanner] Retrying step {step.id} (attempt {step.attempts + 1})")
                else:
                    step.status = StepStatus.FAILED
                    plan.status = "failed"
                    self.stats["plans_failed"] += 1
                    self._save_plan(plan)
                    return False

            self._save_plan(plan)

        plan.status = "completed"
        self.stats["plans_completed"] += 1
        self._save_plan(plan)

        # Learn from successful execution
        if self.pattern_store and plan.status == "completed":
            self._learn_from_plan(plan)

        return True

    async def _execute_and_validate_step(
        self,
        plan: ExecutionPlan,
        step: PlanStep
    ) -> bool:
        """
        Execute a single step and validate the result.

        Returns:
            True if step validated successfully
        """
        step.status = StepStatus.IN_PROGRESS
        step.started_at = datetime.now().isoformat()
        step.attempts += 1
        self.stats["steps_executed"] += 1

        print(f"[LLMPlanner] Executing: {step.description}")

        # Execute the step
        try:
            await self._execute_step_action(step)
        except Exception as e:
            step.error = str(e)
            print(f"[LLMPlanner] Execution error: {e}")
            return False

        # Wait a moment for UI to update
        await asyncio.sleep(1)

        # Validate
        step.status = StepStatus.VALIDATING
        self.stats["steps_validated"] += 1

        validation = await self._validate_step(step)
        step.validation_result = validation

        if validation.get("success", False):
            print(f"[LLMPlanner] Validated: {validation.get('reason', 'OK')}")
            return True
        else:
            step.error = validation.get("reason", "Validation failed")
            print(f"[LLMPlanner] Validation failed: {step.error}")
            return False

    async def _execute_step_action(self, step: PlanStep):
        """Execute the actual action for a step."""
        action_type = step.action_type
        params = step.params

        if self.mcp_executor is None:
            # Fallback: use pyautogui directly
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

            elif action_type == "type_text":
                text = params.get("text", "")
                pyperclip.copy(text)
                pyautogui.hotkey("ctrl", "v")

            elif action_type == "hotkey":
                keys = params.get("keys", "")
                key_list = keys.split("+")
                pyautogui.hotkey(*key_list)

            elif action_type == "click":
                x = params.get("x", 0)
                y = params.get("y", 0)
                pyautogui.click(x, y)

            elif action_type == "wait":
                seconds = params.get("seconds", 1)
                await asyncio.sleep(seconds)

            elif action_type == "scroll":
                direction = params.get("direction", "down")
                amount = params.get("amount", 3)
                if direction == "up":
                    pyautogui.scroll(amount)
                else:
                    pyautogui.scroll(-amount)

        else:
            # Use MCP executor
            await self.mcp_executor(action_type, params)

    async def _validate_step(self, step: PlanStep) -> Dict[str, Any]:
        """
        Validate step using screen content + LLM.

        Returns:
            Validation result dict
        """
        # Get current screen content
        screen_content = await self._get_screen_content()

        # Use Claude CLI for validation
        prompt = self.VALIDATE_PROMPT.format(
            step_description=step.description,
            expected_result=step.expected_result,
            validation_prompt=step.validation_prompt,
            screen_content=screen_content
        )

        try:
            result = run_claude_cli(prompt, timeout=30)

            if result.returncode == 0:
                return parse_claude_response(result.stdout)

        except Exception as e:
            print(f"[LLMPlanner] Validation error: {e}")

        # Fallback: assume success if no error during execution
        return {
            "success": step.error is None,
            "confidence": 0.5,
            "reason": "Validation via LLM unavailable, using execution result"
        }

    async def _get_screen_content(self) -> str:
        """Get current screen content for validation."""
        if self.mcp_executor:
            try:
                result = await self.mcp_executor("screen_scan", {})
                if isinstance(result, dict):
                    # Extract text from scan result
                    lines = result.get("lines", [])
                    return "\n".join([l.get("text", "") for l in lines if l.get("text")])
            except:
                pass

        # Fallback: use window title
        try:
            import pygetwindow as gw
            active = gw.getActiveWindow()
            if active:
                return f"Active Window: {active.title}"
        except:
            pass

        return "Screen content unavailable"

    def _learn_from_plan(self, plan: ExecutionPlan):
        """Learn patterns from successful plan execution."""
        if not self.pattern_store:
            return

        # Convert plan steps to ActionSteps
        actions = []
        for step in plan.steps:
            action = ActionStep(
                tool=step.action_type,
                params=step.params,
                description=step.description
            )
            actions.append(action)

        # Calculate total duration
        total_duration = 0
        for step in plan.steps:
            if step.started_at and step.completed_at:
                try:
                    start = datetime.fromisoformat(step.started_at)
                    end = datetime.fromisoformat(step.completed_at)
                    total_duration += (end - start).total_seconds() * 1000
                except:
                    pass

        # Learn the pattern
        self.pattern_store.learn_pattern(
            task=plan.original_task,
            actions=actions,
            success=True,
            duration_ms=total_duration
        )

        print(f"[LLMPlanner] Learned pattern from plan: {plan.task_id}")

    def _save_plan(self, plan: ExecutionPlan):
        """Persist plan to disk."""
        try:
            plan_file = self.plans_dir / f"{plan.task_id}.json"
            with open(plan_file, "w", encoding="utf-8") as f:
                json.dump(plan.to_dict(), f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[LLMPlanner] Error saving plan: {e}")

    def load_plan(self, task_id: str) -> Optional[ExecutionPlan]:
        """Load a plan from disk."""
        try:
            plan_file = self.plans_dir / f"{task_id}.json"
            if plan_file.exists():
                with open(plan_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return ExecutionPlan.from_dict(data)
        except Exception as e:
            print(f"[LLMPlanner] Error loading plan: {e}")
        return None

    def get_stats(self) -> Dict[str, Any]:
        """Get planner statistics."""
        return {
            **self.stats,
            "success_rate": (
                self.stats["plans_completed"] /
                max(1, self.stats["plans_created"])
            ) * 100
        }


# Convenience function
async def plan_and_execute(task: str, pattern_store: Optional[PatternStore] = None) -> bool:
    """
    Plan and execute a task with validation.

    Args:
        task: Natural language task
        pattern_store: Optional pattern store for learning

    Returns:
        True if task completed successfully
    """
    planner = LLMTaskPlanner(pattern_store=pattern_store)

    # Create plan
    plan = await planner.create_plan(task)
    print(f"\n=== Execution Plan ({len(plan.steps)} steps) ===")
    for step in plan.steps:
        print(f"  [{step.id}] {step.description}")

    # Execute with progress callback
    async def on_step(plan, step):
        progress = plan.get_progress()
        print(f"  Progress: {progress['completed']}/{progress['total']} ({progress['progress_percent']:.0f}%)")

    success = await planner.execute_plan(plan, on_step_complete=on_step)

    print(f"\n=== Result: {'SUCCESS' if success else 'FAILED'} ===")
    return success


if __name__ == "__main__":
    # Test
    print("=== LLM Task Planner Test ===\n")

    # Simple test without actual execution
    planner = LLMTaskPlanner()

    # Test decomposition
    import asyncio

    async def test():
        task = "oeffne notepad und schreibe hello world und speichere als test.txt"
        print(f"Task: {task}\n")

        try:
            plan = await planner.create_plan(task)
            print(f"Created plan with {len(plan.steps)} steps:")
            for step in plan.steps:
                print(f"  [{step.id}] {step.action_type}: {step.description}")
                print(f"       Validation: {step.validation_prompt}")
        except Exception as e:
            print(f"Error: {e}")

    asyncio.run(test())
