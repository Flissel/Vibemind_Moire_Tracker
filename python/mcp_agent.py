"""
MCP Automation Agent - Opus 4.5 powered intelligent automation
Wraps interactive_mcp as tools for an LLM agent that understands the system.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from interactive_mcp import MCPAutomation, PatternMatcher
from learning.validation_supervisor import ContentTracker, get_content_tracker, reset_content_tracker
from core.openrouter_client import OpenRouterClient


# ============================================================
# SYSTEM KNOWLEDGE - What the agent knows about MCP
# ============================================================

MCP_SYSTEM_KNOWLEDGE = """
# MCP Automation System - Complete Knowledge Base

Du bist ein Experte fuer das MCP Automation System. Du kannst Desktop-Automatisierung durchfuehren.

## Verfuegbare Tools

### 1. run_task(task: str)
Fuehrt einen Task aus. Das System routet automatisch:
- **Direct Patterns**: Schnelle lokale Ausfuehrung (Shortcuts, Tippen, Apps oeffnen)
- **Claude CLI**: Komplexe Tasks die Planung brauchen

### 2. action_hotkey(keys: str)
Direkter Tastatur-Shortcut, z.B. "ctrl+c", "alt+tab", "win+r"

### 3. action_type(text: str)
Text tippen (Zeichenweise)

### 4. action_press(key: str)
Einzelne Taste druecken: enter, tab, escape, up, down, left, right, home, end

### 5. action_click(x: int, y: int)
Mausklick an Position

### 6. action_scroll(direction: str, amount: int)
Scrollen: direction="up" oder "down"

## Pattern-Routing (Automatisch)

Das System erkennt diese Patterns und fuehrt sie DIREKT aus:

### Apps Oeffnen
- "open word" -> Win+R, winword, Enter
- "open excel" -> Win+R, excel, Enter
- "open notepad" -> Win+R, notepad, Enter
- "open chrome" -> Win+R, chrome, Enter
- "open [app]" -> Win+R, [cmd], Enter

### Shortcuts
| Befehl | Aktion |
|--------|--------|
| new | Ctrl+N |
| save | Ctrl+S |
| save as [file] | Ctrl+Shift+S, tippen, Enter |
| copy | Ctrl+C |
| paste | Ctrl+V |
| cut | Ctrl+X |
| undo | Ctrl+Z |
| redo | Ctrl+Y |
| select all | Ctrl+A |
| find [term] | Ctrl+F, tippen, Enter |
| bold | Ctrl+B |
| italic | Ctrl+I |
| underline | Ctrl+U |
| center | Ctrl+E |
| left | Ctrl+L |
| right | Ctrl+R |
| justify | Ctrl+J |
| heading 1 | Ctrl+Alt+1 |
| heading 2 | Ctrl+Alt+2 |
| heading 3 | Ctrl+Alt+3 |
| home | Ctrl+Home |
| end | Ctrl+End |
| page break | Ctrl+Enter |

### Text Tippen
- "type [text]" -> Tippt den Text

### Navigation
- "scroll up/down" -> Scrollt
- "click [element]" -> Klickt (via Claude CLI)

## Workflow Best Practices

### Word Dokument erstellen:
1. "open word" - Word oeffnen
2. Warte 3 Sekunden (Word braucht Zeit)
3. "new" - Neues Dokument (System handhabt Start-Screen automatisch!)
4. "type [Titel]" - Titel schreiben
5. action_hotkey("shift+home") - Titel selektieren
6. "bold" - Fett machen
7. "center" - Zentrieren
8. "heading 1" - Als Ueberschrift formatieren
9. action_press("end") + action_press("enter") - Neue Zeile
10. Weiteren Text tippen...
11. "save as [name].docx" - Speichern

### Word Start-Screen Problem (GELOEST):
- Word 365 zeigt beim Start immer einen Template-Screen
- Das System erkennt dies automatisch!
- Nach "open word" + "new" wird automatisch Escape gedrueckt
- Das schliesst den Start-Screen und zeigt das leere Dokument
- Keine manuelle Behandlung noetig - einfach "new" aufrufen

### Tabellen in Word:
- Komplexe Tabellen via Claude CLI: "insert a table with 3 columns and 4 rows"
- Dann mit Tab durch Zellen navigieren und tippen

### Formatierung:
- Erst Text selektieren (shift+home, shift+end, ctrl+a)
- Dann Formatierung anwenden (bold, italic, center, etc.)

## ContentTracker
Das System trackt automatisch:
- Alle getippten Texte
- Alle Formatierungen
- Dokumentstruktur (Headings, etc.)

Dieser Kontext wird dem Validator uebergeben fuer bessere Validierung.

## Validation
Nach jeder Aktion:
1. Screenshot vorher/nachher
2. Pixel-Diff Check (schnell)
3. LLM Vision Check (genau, wenn Pixel-Diff unsicher)

## Fehler vermeiden
- Immer warten nach App-Start (3s fuer Word/Excel)
- Text erst selektieren, dann formatieren
- Bei Word: "new" oeffnet Template-Picker, besser direkt auf "Leeres Dokument" klicken
- Umlaute vermeiden (ae statt ä) fuer bessere Kompatibilitaet
"""


# ============================================================
# TOOL DEFINITIONS
# ============================================================

TOOL_DEFINITIONS = [
    {
        "name": "run_task",
        "description": "Execute an automation task. The system routes automatically to direct patterns or Claude CLI.",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The task to execute, e.g. 'open word', 'type Hello World', 'bold', 'save as doc.docx'"
                }
            },
            "required": ["task"]
        }
    },
    {
        "name": "action_hotkey",
        "description": "Press a keyboard shortcut directly",
        "parameters": {
            "type": "object",
            "properties": {
                "keys": {
                    "type": "string",
                    "description": "The key combination, e.g. 'ctrl+c', 'alt+tab', 'shift+home'"
                }
            },
            "required": ["keys"]
        }
    },
    {
        "name": "action_type",
        "description": "Type text character by character",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to type"
                }
            },
            "required": ["text"]
        }
    },
    {
        "name": "action_press",
        "description": "Press a single key",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "The key to press: enter, tab, escape, up, down, left, right, home, end, backspace, delete"
                }
            },
            "required": ["key"]
        }
    },
    {
        "name": "action_click",
        "description": "Click at screen coordinates",
        "parameters": {
            "type": "object",
            "properties": {
                "x": {"type": "integer", "description": "X coordinate"},
                "y": {"type": "integer", "description": "Y coordinate"}
            },
            "required": ["x", "y"]
        }
    },
    {
        "name": "action_scroll",
        "description": "Scroll the mouse wheel",
        "parameters": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["up", "down"]},
                "amount": {"type": "integer", "default": 3}
            },
            "required": ["direction"]
        }
    },
    {
        "name": "wait",
        "description": "Wait for a number of seconds",
        "parameters": {
            "type": "object",
            "properties": {
                "seconds": {"type": "number", "description": "Seconds to wait"}
            },
            "required": ["seconds"]
        }
    },
    {
        "name": "get_content_log",
        "description": "Get the current content tracker log (what was typed/formatted)",
        "parameters": {"type": "object", "properties": {}}
    },
    {
        "name": "reset_session",
        "description": "Reset the content tracker for a new session",
        "parameters": {"type": "object", "properties": {}}
    }
]


@dataclass
class AgentResponse:
    """Response from the agent."""
    success: bool
    message: str
    tool_calls: List[Dict[str, Any]]
    final_result: Optional[str] = None


class MCPAgent:
    """
    Intelligent agent that uses MCP automation tools.
    Powered by Opus 4.5 via OpenRouter.
    """

    def __init__(self, model: str = "anthropic/claude-sonnet-4"):
        """
        Initialize the agent.

        Args:
            model: OpenRouter model ID (default: claude-sonnet-4, can use claude-opus-4)
        """
        self.model = model
        self.mcp = MCPAutomation(learning_mode=True)
        self.client = OpenRouterClient()
        self.conversation_history: List[Dict[str, Any]] = []
        self.content_tracker = get_content_tracker()

        print(f"[MCPAgent] Initialized with model: {model}")
        print(f"[MCPAgent] Tools available: {len(TOOL_DEFINITIONS)}")

    async def execute_tool(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool and return the result."""
        try:
            if tool_name == "run_task":
                await self.mcp.run_task(params["task"])
                return {"success": True, "message": f"Task executed: {params['task']}"}

            elif tool_name == "action_hotkey":
                await self.mcp.action_hotkey(params["keys"])
                return {"success": True, "message": f"Hotkey pressed: {params['keys']}"}

            elif tool_name == "action_type":
                await self.mcp.action_type(params["text"])
                # Track in content tracker
                self.content_tracker.add_typed_text(params["text"])
                return {"success": True, "message": f"Typed: {params['text'][:50]}..."}

            elif tool_name == "action_press":
                await self.mcp.action_press(params["key"])
                return {"success": True, "message": f"Key pressed: {params['key']}"}

            elif tool_name == "action_click":
                await self.mcp.action_click(params["x"], params["y"])
                return {"success": True, "message": f"Clicked at ({params['x']}, {params['y']})"}

            elif tool_name == "action_scroll":
                direction = params["direction"]
                amount = params.get("amount", 3)
                await self.mcp.action_scroll(direction, amount)
                return {"success": True, "message": f"Scrolled {direction} by {amount}"}

            elif tool_name == "wait":
                await asyncio.sleep(params["seconds"])
                return {"success": True, "message": f"Waited {params['seconds']}s"}

            elif tool_name == "get_content_log":
                summary = self.content_tracker.get_context_summary()
                return {"success": True, "content": summary}

            elif tool_name == "reset_session":
                reset_content_tracker()
                self.content_tracker = get_content_tracker()
                return {"success": True, "message": "Session reset"}

            else:
                return {"success": False, "error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def chat(self, user_message: str) -> AgentResponse:
        """
        Process a user message and execute any required tools.

        Args:
            user_message: The user's request

        Returns:
            AgentResponse with the result
        """
        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })

        # Build messages for API call
        messages = [
            {"role": "system", "content": MCP_SYSTEM_KNOWLEDGE},
            *self.conversation_history
        ]

        # Call OpenRouter with tools
        tool_calls_made = []
        max_iterations = 10  # Prevent infinite loops

        for iteration in range(max_iterations):
            response = await self.client.chat(
                messages=messages,
                model=self.model,
                tools=TOOL_DEFINITIONS,
                temperature=0.3
            )

            if not response:
                return AgentResponse(
                    success=False,
                    message="No response from model",
                    tool_calls=tool_calls_made
                )

            # Check if there are tool calls (content can be empty when tool_calls present)
            if response.tool_calls:
                for tool_call in response.tool_calls:
                    tool_name = tool_call.get("name")
                    tool_params = tool_call.get("parameters", {})

                    print(f"[MCPAgent] Tool call: {tool_name}({json.dumps(tool_params, ensure_ascii=False)[:100]})")

                    # Execute the tool
                    result = await self.execute_tool(tool_name, tool_params)
                    tool_calls_made.append({
                        "tool": tool_name,
                        "params": tool_params,
                        "result": result
                    })

                    # Add tool result to messages
                    messages.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": tool_name, "arguments": json.dumps(tool_params)}}]
                    })
                    messages.append({
                        "role": "tool",
                        "tool_call_id": "call_1",
                        "content": json.dumps(result, ensure_ascii=False)
                    })

                    # Small delay between tool calls
                    await asyncio.sleep(0.3)
            else:
                # No more tool calls, we have the final response
                final_content = response.content or "Aufgabe erledigt."
                self.conversation_history.append({
                    "role": "assistant",
                    "content": final_content
                })

                return AgentResponse(
                    success=True,
                    message=final_content,
                    tool_calls=tool_calls_made,
                    final_result=final_content
                )

        return AgentResponse(
            success=True,
            message="Max iterations reached",
            tool_calls=tool_calls_made
        )

    def reset(self):
        """Reset the conversation and content tracker."""
        self.conversation_history.clear()
        reset_content_tracker()
        self.content_tracker = get_content_tracker()


# ============================================================
# INTERACTIVE CLI
# ============================================================

async def interactive_session():
    """Run an interactive session with the MCP Agent."""
    print("="*60)
    print("  MCP Automation Agent - Opus 4.5 Powered")
    print("="*60)
    print("\nBefehle:")
    print("  - Beliebige Automation-Anfrage eingeben")
    print("  - 'reset' - Session zuruecksetzen")
    print("  - 'log' - Content Log anzeigen")
    print("  - 'quit' - Beenden")
    print("="*60)

    # Use Sonnet for faster responses, can switch to Opus
    agent = MCPAgent(model="anthropic/claude-sonnet-4")

    while True:
        try:
            user_input = input("\n> ").strip()

            if not user_input:
                continue

            if user_input.lower() == "quit":
                print("Auf Wiedersehen!")
                break

            if user_input.lower() == "reset":
                agent.reset()
                print("[Session zurueckgesetzt]")
                continue

            if user_input.lower() == "log":
                print(agent.content_tracker.get_context_summary())
                continue

            # Process the request
            print(f"\n[Processing: {user_input[:50]}...]")
            response = await agent.chat(user_input)

            if response.tool_calls:
                print(f"\n[Tools aufgerufen: {len(response.tool_calls)}]")
                for tc in response.tool_calls:
                    status = "OK" if tc["result"].get("success") else "FEHLER"
                    print(f"  - {tc['tool']}: {status}")

            if response.final_result:
                print(f"\n{response.final_result}")

        except KeyboardInterrupt:
            print("\n\nAbgebrochen.")
            break
        except Exception as e:
            print(f"\n[ERROR] {e}")

    await agent.client.close()


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    asyncio.run(interactive_session())
