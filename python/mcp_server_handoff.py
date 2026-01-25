"""
MCP Server for Handoff Multi-Agent System

Exposes the handoff system to Claude Code for intelligent orchestration
of desktop automation tasks.

Usage:
    python mcp_server_handoff.py

Add to .claude/settings.json:
{
    "mcpServers": {
        "handoff": {
            "command": "python",
            "args": ["path/to/mcp_server_handoff.py"]
        }
    }
}

Production Deployment:
    See service/ directory for Windows service management and health monitoring.
"""

import asyncio
import json
import sys
import os
import signal
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load production config
try:
    from config import load_config, get_config
    _config = load_config()
except ImportError:
    _config = None

# Setup logging
logging.basicConfig(
    level=logging.INFO if not _config else getattr(logging, _config.log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('HandoffMCP')

# MCP imports
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("MCP package not installed. Run: pip install mcp", file=sys.stderr)
    sys.exit(1)

# Handoff system imports
from agents.handoff import (
    PlanningTeam,
    ValidationTeam,
    AgentRuntime,
    UserTask,
)

# Claude CLI import
from agents.orchestrator import ClaudeCLIWrapper

# Global instances (initialized lazily)
_planning_team: Optional[PlanningTeam] = None
_validation_team: Optional[ValidationTeam] = None
_runtime: Optional[AgentRuntime] = None
_claude_cli: Optional[ClaudeCLIWrapper] = None


def get_claude_cli() -> ClaudeCLIWrapper:
    """Get or create the Claude CLI wrapper (singleton)."""
    global _claude_cli
    if _claude_cli is None:
        _claude_cli = ClaudeCLIWrapper()
    return _claude_cli


async def get_planning_team() -> PlanningTeam:
    """Get or create the planning team (singleton)."""
    global _planning_team
    if _planning_team is None:
        _planning_team = PlanningTeam(max_debate_rounds=2, use_llm=True)
        await _planning_team.start()
    return _planning_team


async def get_validation_team() -> ValidationTeam:
    """Get or create the validation team (singleton)."""
    global _validation_team
    if _validation_team is None:
        _validation_team = ValidationTeam(confidence_threshold=0.6)
        await _validation_team.start()
    return _validation_team


async def get_runtime() -> AgentRuntime:
    """Get or create the agent runtime (singleton)."""
    global _runtime
    if _runtime is None:
        _runtime = AgentRuntime()
    return _runtime


# Tool definitions
TOOLS = [
    Tool(
        name="handoff_plan",
        description="Create a desktop automation plan using LLM-powered Planner + Critic. "
                    "Returns a plan with steps, approval status, issues, and confidence score.",
        inputSchema={
            "type": "object",
            "properties": {
                "goal": {
                    "type": "string",
                    "description": "What to accomplish (e.g., 'open notepad and type hello')"
                },
                "context": {
                    "type": "object",
                    "description": "Additional context (e.g., {message: 'hello', user_feedback: '...'})"
                }
            },
            "required": ["goal"]
        }
    ),
    Tool(
        name="handoff_execute",
        description="Execute a plan's automation steps. Each step can be: hotkey, sleep, write, press, click, find_and_click.",
        inputSchema={
            "type": "object",
            "properties": {
                "plan": {
                    "type": "array",
                    "description": "List of plan steps to execute",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "description": {"type": "string"}
                        }
                    }
                }
            },
            "required": ["plan"]
        }
    ),
    Tool(
        name="handoff_validate",
        description="Find and validate a UI element on screen. Returns location coordinates and confidence.",
        inputSchema={
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "Element to find (e.g., 'chat input field', 'send button')"
                },
                "expected_state": {
                    "type": "object",
                    "description": "Optional expected screen state for validation"
                }
            },
            "required": ["target"]
        }
    ),
    Tool(
        name="handoff_action",
        description="Execute a direct automation action (hotkey, type, press, click, sleep, scroll).",
        inputSchema={
            "type": "object",
            "properties": {
                "action_type": {
                    "type": "string",
                    "enum": ["hotkey", "type", "press", "click", "sleep", "scroll"],
                    "description": "Type of action to perform"
                },
                "params": {
                    "type": "object",
                    "description": "Action parameters (keys, text, key, x/y, seconds, direction/amount for scroll)",
                    "properties": {
                        "keys": {"type": "string", "description": "For hotkey: keys like 'ctrl+alt+space'"},
                        "text": {"type": "string", "description": "For type: text to type"},
                        "key": {"type": "string", "description": "For press: key name like 'enter'"},
                        "x": {"type": "integer", "description": "For click/scroll: x coordinate"},
                        "y": {"type": "integer", "description": "For click/scroll: y coordinate"},
                        "seconds": {"type": "number", "description": "For sleep: duration"},
                        "direction": {"type": "string", "enum": ["up", "down"], "description": "For scroll: direction"},
                        "amount": {"type": "integer", "description": "For scroll: number of scroll clicks (default 3)"}
                    }
                }
            },
            "required": ["action_type", "params"]
        }
    ),
    Tool(
        name="handoff_status",
        description="Get the status of the handoff system including runtime stats.",
        inputSchema={
            "type": "object",
            "properties": {}
        }
    ),
    Tool(
        name="handoff_read_screen",
        description="Capture screenshot and read text from screen using OCR. Returns visible text content.",
        inputSchema={
            "type": "object",
            "properties": {
                "region": {
                    "type": "object",
                    "description": "Optional region to capture {x, y, width, height}. If not provided, captures full screen.",
                    "properties": {
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                        "width": {"type": "integer"},
                        "height": {"type": "integer"}
                    }
                }
            }
        }
    ),
    Tool(
        name="handoff_get_focus",
        description="Get the currently active/focused window. Returns window title, handle, and process ID. Use this to verify the correct window is focused before typing.",
        inputSchema={
            "type": "object",
            "properties": {}
        }
    ),
    Tool(
        name="handoff_scroll",
        description="Scroll the mouse wheel up or down. Can scroll at current position or at a specific location.",
        inputSchema={
            "type": "object",
            "properties": {
                "direction": {
                    "type": "string",
                    "enum": ["up", "down"],
                    "description": "Direction to scroll"
                },
                "amount": {
                    "type": "integer",
                    "description": "Number of scroll clicks (default: 3). Positive values scroll the content, negative not supported - use direction instead."
                },
                "x": {
                    "type": "integer",
                    "description": "Optional x coordinate to scroll at. If not provided, scrolls at current mouse position."
                },
                "y": {
                    "type": "integer",
                    "description": "Optional y coordinate to scroll at. If not provided, scrolls at current mouse position."
                }
            },
            "required": ["direction"]
        }
    ),
    # Claude CLI Tools
    Tool(
        name="claude_cli_run",
        description="Run a prompt via Claude CLI. Can use skills and output as JSON.",
        inputSchema={
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "The prompt to send to Claude"
                },
                "skill": {
                    "type": "string",
                    "description": "Optional skill name to use"
                },
                "output_format": {
                    "type": "string",
                    "enum": ["text", "json"],
                    "default": "text",
                    "description": "Output format: text or json"
                }
            },
            "required": ["prompt"]
        }
    ),
    Tool(
        name="claude_cli_skill",
        description="Execute a Claude Skill with inputs.",
        inputSchema={
            "type": "object",
            "properties": {
                "skill_name": {
                    "type": "string",
                    "description": "Name of the skill (without .md extension)"
                },
                "inputs": {
                    "type": "object",
                    "description": "Input parameters for the skill"
                },
                "ui_context": {
                    "type": "object",
                    "description": "Optional UI context for desktop automation skills"
                }
            },
            "required": ["skill_name", "inputs"]
        }
    ),
    Tool(
        name="claude_cli_list_skills",
        description="List all available Claude Skills from ~/.claude/skills/ and project .claude/skills/",
        inputSchema={
            "type": "object",
            "properties": {}
        }
    ),
    Tool(
        name="claude_cli_status",
        description="Check if Claude CLI is installed and available.",
        inputSchema={
            "type": "object",
            "properties": {}
        }
    ),
    Tool(
        name="vision_analyze",
        description="Analyze screenshot with Gemini Vision AI. Returns UI analysis, element locations, and suggested automation actions.",
        inputSchema={
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "What to analyze (e.g., 'Find all buttons', 'What is the current state?', 'Locate the login form')"
                },
                "mode": {
                    "type": "string",
                    "enum": ["element_detection", "state_analysis", "task_planning", "custom"],
                    "description": "Analysis mode: element_detection (find UI elements), state_analysis (describe screen state), task_planning (suggest next actions), custom (free-form analysis)"
                },
                "json_output": {
                    "type": "boolean",
                    "default": True,
                    "description": "Return structured JSON response when possible"
                },
                "monitor_id": {
                    "type": "integer",
                    "default": 0,
                    "description": "Monitor index for multi-monitor setups (0 = primary)"
                }
            },
            "required": ["prompt"]
        }
    )
]


# Tool handlers
async def handle_plan(goal: str, context: Optional[Dict] = None) -> Dict[str, Any]:
    """Create a plan using PlanningTeam."""
    team = await get_planning_team()
    result = await team.create_plan(goal, context=context or {})
    return result


async def handle_execute(plan: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Execute plan steps."""
    import pyautogui
    import pyperclip

    results = []
    success = True

    for i, step in enumerate(plan):
        step_type = step.get('type', '')
        step_result = {"step": i + 1, "type": step_type, "success": False}

        try:
            if step_type == 'hotkey':
                keys = step.get('keys', '').replace('+', ' ').split()
                if keys:
                    pyautogui.hotkey(*keys)
                step_result["success"] = True

            elif step_type == 'sleep':
                duration = step.get('duration', step.get('seconds', 1))
                await asyncio.sleep(float(duration))
                step_result["success"] = True

            elif step_type == 'write':
                text = step.get('text', step.get('content', ''))
                if text:
                    pyperclip.copy(text)
                    pyautogui.hotkey('ctrl', 'v')
                step_result["success"] = True

            elif step_type == 'press':
                key = step.get('key', 'enter')
                pyautogui.press(key)
                step_result["success"] = True

            elif step_type == 'click':
                x = step.get('x', 0)
                y = step.get('y', 0)
                pyautogui.click(int(x), int(y))
                step_result["success"] = True

            elif step_type == 'find_and_click':
                target = step.get('target', step.get('text', ''))
                if target:
                    team = await get_validation_team()
                    loc_result = await team.validate_element(target)
                    if loc_result.get('element_location'):
                        loc = loc_result['element_location']
                        pyautogui.click(loc['x'], loc['y'])
                        step_result["success"] = True
                        step_result["location"] = loc
                    else:
                        step_result["error"] = f"Could not find '{target}'"
                        success = False
            else:
                step_result["error"] = f"Unknown step type: {step_type}"

            # Small delay between steps
            await asyncio.sleep(0.3)

        except Exception as e:
            step_result["error"] = str(e)
            success = False

        results.append(step_result)

    return {
        "success": success,
        "steps_executed": len(results),
        "results": results
    }


async def handle_validate(target: str, expected_state: Optional[Dict] = None) -> Dict[str, Any]:
    """Validate a UI element."""
    team = await get_validation_team()
    result = await team.validate_element(target, expected_state)
    return result


async def handle_get_focus() -> Dict[str, Any]:
    """Get the currently active window."""
    from agents.handoff.window_focus import get_active_window
    return await get_active_window()


async def handle_scroll(direction: str, amount: int = 3, x: Optional[int] = None, y: Optional[int] = None) -> Dict[str, Any]:
    """Scroll the mouse wheel up or down."""
    import pyautogui

    try:
        # Move to position if specified
        if x is not None and y is not None:
            pyautogui.moveTo(x, y)

        # Determine scroll amount (positive = up, negative = down)
        clicks = abs(amount) if amount else 3
        if direction == "down":
            clicks = -clicks

        # Perform scroll
        pyautogui.scroll(clicks)

        return {
            "success": True,
            "action": "scroll",
            "direction": direction,
            "clicks": abs(amount) if amount else 3,
            "position": {"x": x, "y": y} if x is not None else "current"
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_action(action_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a direct action with optional focus verification."""
    import pyautogui
    import pyperclip

    # Optional focus verification before action
    verify_focus = params.get('verify_focus', False)
    target_window = params.get('target_window', None)

    if verify_focus and target_window:
        from agents.handoff.window_focus import verify_window_focus
        focus_result = await verify_window_focus(target_window, timeout=3.0)
        if not focus_result["success"]:
            return {
                "success": False,
                "error": f"Window not focused: {target_window}",
                "focus_result": focus_result
            }

    try:
        if action_type == 'hotkey':
            keys = params.get('keys', '').replace('+', ' ').split()
            if keys:
                pyautogui.hotkey(*keys)
            return {"success": True, "action": "hotkey", "keys": keys}

        elif action_type == 'type':
            text = params.get('text', '')
            if text:
                pyperclip.copy(text)
                pyautogui.hotkey('ctrl', 'v')
            return {"success": True, "action": "type", "text_length": len(text)}

        elif action_type == 'press':
            key = params.get('key', 'enter')
            pyautogui.press(key)
            return {"success": True, "action": "press", "key": key}

        elif action_type == 'click':
            x = params.get('x', 0)
            y = params.get('y', 0)
            pyautogui.click(int(x), int(y))
            return {"success": True, "action": "click", "x": x, "y": y}

        elif action_type == 'sleep':
            seconds = params.get('seconds', 1)
            await asyncio.sleep(float(seconds))
            return {"success": True, "action": "sleep", "seconds": seconds}

        elif action_type == 'scroll':
            direction = params.get('direction', 'down')
            amount = params.get('amount', 3)
            x = params.get('x')
            y = params.get('y')

            # Move to position if specified
            if x is not None and y is not None:
                pyautogui.moveTo(x, y)

            # Scroll (positive = up, negative = down)
            clicks = abs(amount) if amount else 3
            if direction == "down":
                clicks = -clicks
            pyautogui.scroll(clicks)

            return {
                "success": True,
                "action": "scroll",
                "direction": direction,
                "clicks": abs(amount) if amount else 3,
                "position": {"x": x, "y": y} if x is not None else "current"
            }

        else:
            return {"success": False, "error": f"Unknown action type: {action_type}"}

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_status() -> Dict[str, Any]:
    """Get system status."""
    runtime = await get_runtime()
    stats = runtime.get_stats()

    return {
        "runtime": {
            "tasks_processed": stats.get('tasks_processed', 0),
            "handoffs_routed": stats.get('handoffs_routed', 0),
            "errors": stats.get('errors', 0)
        },
        "planning_team": {
            "initialized": _planning_team is not None,
            "llm_enabled": _planning_team._use_llm if _planning_team else False
        },
        "validation_team": {
            "initialized": _validation_team is not None,
            "confidence_threshold": _validation_team.confidence_threshold if _validation_team else 0.6
        }
    }


async def handle_read_screen(region: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """Capture screen and read text using OCR."""
    import pyautogui
    from PIL import Image
    import io
    import base64

    try:
        # Capture screenshot
        if region:
            x = region.get('x', 0)
            y = region.get('y', 0)
            width = region.get('width', 800)
            height = region.get('height', 600)
            screenshot = pyautogui.screenshot(region=(x, y, width, height))
        else:
            screenshot = pyautogui.screenshot()

        # Convert to base64 for potential vision processing
        buffer = io.BytesIO()
        screenshot.save(buffer, format='PNG')
        screenshot_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

        text_content = ""
        ocr_method = "none"

        # Try pytesseract first (more reliable, local)
        try:
            import pytesseract
            import shutil
            # Auto-detect Tesseract path or use environment variable
            tesseract_path = os.getenv("TESSERACT_PATH") or shutil.which("tesseract")
            if tesseract_path:
                pytesseract.pytesseract.tesseract_cmd = tesseract_path
            text_content = pytesseract.image_to_string(screenshot)
            ocr_method = "pytesseract"
        except ImportError:
            pass  # pytesseract not installed, try MoireServer
        except Exception as tess_error:
            pass  # pytesseract failed, try MoireServer

        # If pytesseract failed, try MoireServer as fallback
        if not text_content.strip():
            try:
                from bridge.websocket_client import MoireWebSocketClient
                client = MoireWebSocketClient(host="localhost", port=8766)
                await asyncio.wait_for(client.connect(), timeout=5.0)

                # Wait for complete capture with OCR (timeout 60s for large screens)
                result = await client.capture_and_wait_for_complete(timeout=60.0)

                if result.success and result.ui_context:
                    # Extract texts from UIContext elements
                    texts = []
                    for element in result.ui_context.elements:
                        if element.text:
                            texts.append(element.text)
                    text_content = "\n".join(texts)
                    ocr_method = "moire_server"

                    # Update screenshot from MoireServer if available
                    if result.screenshot_base64:
                        screenshot_base64 = result.screenshot_base64
                        if screenshot_base64.startswith('data:'):
                            screenshot_base64 = screenshot_base64.split(',', 1)[1]

                await client.disconnect()

            except Exception as moire_error:
                import logging
                logging.getLogger(__name__).warning(f"MoireServer fallback failed: {moire_error}")

        result = {
            "success": True,
            "text": text_content,
            "text_length": len(text_content),
            "ocr_method": ocr_method,
            "screenshot_size": {
                "width": screenshot.width,
                "height": screenshot.height
            }
        }

        # Include base64 screenshot if OCR failed (empty text)
        if not text_content.strip():
            result["screenshot_base64"] = screenshot_base64
            result["note"] = "OCR returned empty. Screenshot base64 included for vision analysis."

        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


# Claude CLI Handlers
async def handle_claude_run(prompt: str, skill: Optional[str] = None, output_format: str = "text") -> Dict[str, Any]:
    """Run a prompt via Claude CLI."""
    try:
        cli = get_claude_cli()

        if not cli.is_available():
            return {
                "success": False,
                "error": "Claude CLI not available. Install with: npm install -g @anthropic-ai/claude-cli"
            }

        # Build command args
        args = []
        if skill:
            args.extend(["--skill", skill])
        if output_format == "json":
            args.append("--output-format=json")

        # Run the command (async)
        result = await cli.run_command(prompt, skill=skill, output_format=output_format)

        return {
            "success": result.get("success", False),
            "output": result.get("output"),
            "error": result.get("error"),
            "prompt": prompt,
            "skill": skill,
            "output_format": output_format
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_claude_skill(skill_name: str, inputs: Dict[str, Any], ui_context: Optional[Dict] = None) -> Dict[str, Any]:
    """Execute a Claude Skill with inputs."""
    try:
        cli = get_claude_cli()

        if not cli.is_available():
            return {
                "success": False,
                "error": "Claude CLI not available. Install with: npm install -g @anthropic-ai/claude-cli"
            }

        # Run the skill (async)
        result = await cli.run_skill(skill_name, inputs, ui_context=ui_context)

        return {
            "success": result.get("success", False),
            "output": result.get("output"),
            "error": result.get("error"),
            "skill_name": skill_name,
            "inputs": inputs
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_claude_list_skills() -> Dict[str, Any]:
    """List all available Claude Skills."""
    try:
        cli = get_claude_cli()

        if not cli.is_available():
            return {
                "success": False,
                "error": "Claude CLI not available. Install with: npm install -g @anthropic-ai/claude-cli"
            }

        skills = cli.list_skills()

        return {
            "success": True,
            "skills": skills,
            "count": len(skills)
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_claude_status() -> Dict[str, Any]:
    """Check if Claude CLI is installed and available."""
    try:
        cli = get_claude_cli()

        available = cli.is_available()
        cli_path = cli.cli_path if hasattr(cli, 'cli_path') else None

        result = {
            "success": True,
            "available": available,
            "cli_path": cli_path
        }

        if available:
            # Try to get version or additional info
            try:
                skills = cli.list_skills()
                result["skills_count"] = len(skills)
            except:
                pass

        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


async def handle_vision_analyze(
    prompt: str,
    mode: str = "custom",
    json_output: bool = True,
    monitor_id: int = 0
) -> Dict[str, Any]:
    """Analyze screenshot with Gemini Vision AI."""
    import io

    try:
        # Try to import vision agent
        try:
            from agents.vision_agent import get_vision_agent
            vision_agent = get_vision_agent()
            has_vision = vision_agent is not None and vision_agent.is_available()
        except ImportError:
            has_vision = False
            vision_agent = None

        if not has_vision:
            return {
                "success": False,
                "error": "Vision agent not available. Check OpenRouter API key and vision_agent.py"
            }

        # Get screenshot from cache or capture directly
        screenshot_bytes = None
        cached_frame = None

        # Try StreamFrameCache first (live streaming frames)
        try:
            from stream_frame_cache import StreamFrameCache
            cached_frame = StreamFrameCache.get_fresh_frame(
                monitor_id=monitor_id,
                max_age_ms=2000
            )
            if cached_frame:
                screenshot_bytes = cached_frame.to_bytes()
                logger.info(f"Using cached frame for monitor {monitor_id}")
        except Exception as e:
            logger.debug(f"StreamFrameCache not available: {e}")

        # Fallback to pyautogui screenshot
        if screenshot_bytes is None:
            import pyautogui
            screenshot = pyautogui.screenshot()
            buffer = io.BytesIO()
            screenshot.save(buffer, format='PNG')
            screenshot_bytes = buffer.getvalue()
            logger.info("Using pyautogui screenshot")

        # Build analysis prompt based on mode
        mode_prompts = {
            "element_detection": f"Find all interactive UI elements (buttons, inputs, links, etc.) on this screen. {prompt}. Return as JSON with elements array containing: type, text, approximate_location (x, y), confidence.",
            "state_analysis": f"Analyze the current state of this screen. {prompt}. Describe what application is shown, what's visible, and the current state.",
            "task_planning": f"Based on this screen, suggest the next automation steps to accomplish: {prompt}. Return as JSON with steps array.",
            "custom": prompt
        }

        analysis_prompt = mode_prompts.get(mode, prompt)

        # Run vision analysis
        result = await vision_agent.analyze_with_prompt(
            screenshot_bytes,
            analysis_prompt
        )

        return {
            "success": True,
            "analysis": result,
            "mode": mode,
            "monitor_id": monitor_id,
            "source": "cached_frame" if cached_frame else "pyautogui"
        }

    except Exception as e:
        logger.error(f"Vision analysis failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "mode": mode,
            "monitor_id": monitor_id
        }


# Create MCP server
server = Server("handoff")


@server.list_tools()
async def list_tools() -> List[Tool]:
    """List available tools."""
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    """Handle tool calls."""
    try:
        if name == "handoff_plan":
            result = await handle_plan(
                goal=arguments.get("goal", ""),
                context=arguments.get("context")
            )
        elif name == "handoff_execute":
            result = await handle_execute(
                plan=arguments.get("plan", [])
            )
        elif name == "handoff_validate":
            result = await handle_validate(
                target=arguments.get("target", ""),
                expected_state=arguments.get("expected_state")
            )
        elif name == "handoff_action":
            result = await handle_action(
                action_type=arguments.get("action_type", ""),
                params=arguments.get("params", {})
            )
        elif name == "handoff_status":
            result = await handle_status()
        elif name == "handoff_read_screen":
            result = await handle_read_screen(
                region=arguments.get("region")
            )
        elif name == "handoff_get_focus":
            result = await handle_get_focus()
        elif name == "handoff_scroll":
            result = await handle_scroll(
                direction=arguments.get("direction", "down"),
                amount=arguments.get("amount", 3),
                x=arguments.get("x"),
                y=arguments.get("y")
            )
        # Claude CLI Tools
        elif name == "claude_cli_run":
            result = await handle_claude_run(
                prompt=arguments.get("prompt", ""),
                skill=arguments.get("skill"),
                output_format=arguments.get("output_format", "text")
            )
        elif name == "claude_cli_skill":
            result = await handle_claude_skill(
                skill_name=arguments.get("skill_name", ""),
                inputs=arguments.get("inputs", {}),
                ui_context=arguments.get("ui_context")
            )
        elif name == "claude_cli_list_skills":
            result = await handle_claude_list_skills()
        elif name == "claude_cli_status":
            result = await handle_claude_status()
        elif name == "vision_analyze":
            result = await handle_vision_analyze(
                prompt=arguments.get("prompt", ""),
                mode=arguments.get("mode", "custom"),
                json_output=arguments.get("json_output", True),
                monitor_id=arguments.get("monitor_id", 0)
            )
        else:
            result = {"error": f"Unknown tool: {name}"}

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": str(e)}))]


async def cleanup():
    """Clean up resources on shutdown."""
    global _planning_team, _validation_team, _runtime

    logger.info("Starting cleanup...")

    if _planning_team:
        if hasattr(_planning_team, 'llm_client') and _planning_team.llm_client:
            await _planning_team.llm_client.close()
        await _planning_team.stop()
        _planning_team = None
        logger.info("Planning team stopped")

    if _validation_team:
        await _validation_team.stop()
        _validation_team = None
        logger.info("Validation team stopped")

    if _runtime:
        await _runtime.stop()
        _runtime = None
        logger.info("Runtime stopped")

    logger.info("Cleanup complete")


# Global shutdown flag
_shutdown_requested = False


def signal_handler(signum, frame):
    """Handle shutdown signals for graceful termination."""
    global _shutdown_requested
    signal_name = signal.Signals(signum).name
    logger.info(f"Received signal {signal_name}, initiating graceful shutdown...")
    _shutdown_requested = True


def setup_signal_handlers():
    """Setup signal handlers for graceful shutdown."""
    if sys.platform == 'win32':
        # Windows: Handle SIGINT (Ctrl+C) and SIGBREAK (Ctrl+Break)
        signal.signal(signal.SIGINT, signal_handler)
        try:
            signal.signal(signal.SIGBREAK, signal_handler)
        except AttributeError:
            pass  # SIGBREAK not available on all platforms
    else:
        # Unix: Handle SIGTERM and SIGINT
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)


async def main():
    """Run the MCP server."""
    # Setup signal handlers
    setup_signal_handlers()

    # Log startup
    logger.info("=" * 50)
    logger.info("Handoff MCP Server starting...")
    logger.info(f"Python: {sys.version}")
    logger.info(f"Platform: {sys.platform}")
    if _config:
        logger.info(f"Config loaded: MoireServer {_config.moire_host}:{_config.moire_port}")
    logger.info("=" * 50)

    # Record start time
    start_time = datetime.now()

    try:
        async with stdio_server() as (read_stream, write_stream):
            logger.info("MCP stdio server started, ready for connections")
            await server.run(read_stream, write_stream, server.create_initialization_options())
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise
    finally:
        # Log uptime
        uptime = datetime.now() - start_time
        logger.info(f"Server uptime: {uptime}")

        # Cleanup
        await cleanup()
        logger.info("Handoff MCP Server shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
