"""Test Word Start-Screen Fix with Vision-Based Focus Validation"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

async def test():
    from interactive_mcp import MCPAutomation

    print("=" * 70)
    print("  TEST: Universal Vision-Based Focus Validation")
    print("  - Opens Word")
    print("  - Vision detects app and state (start_screen vs document)")
    print("  - Automatically presses Escape if start_screen detected")
    print("=" * 70)

    mcp = MCPAutomation(learning_mode=True)

    # Check if vision validation is available
    if mcp.validation_supervisor and mcp.validation_supervisor.openrouter_client:
        print("\n[INFO] Vision Validation: ENABLED (OpenRouter)")
    else:
        print("\n[WARNING] Vision Validation: DISABLED (kein OpenRouter API Key)")
        print("[WARNING] Fallback auf einfache Fenster-Titel Pruefung")

    print("\n" + "-" * 70)
    print("[STEP 1] Opening Word...")
    print("-" * 70)

    await mcp.run_task("open word")
    # Vision validation runs automatically after open_app!
    # If it detects start_screen, it presses Escape

    await asyncio.sleep(1)

    # Manual vision check for debugging
    if mcp.validation_supervisor and mcp.validation_supervisor.openrouter_client:
        print("\n[STEP 1b] Manual Vision Check...")
        result = await mcp.validation_supervisor.validate_focus_with_vision(
            expected_app="word",
            expected_state="ready"
        )
        print(f"  Detected App: {result.detected_app}")
        print(f"  Detected State: {result.detected_state}")
        print(f"  Success: {result.success}")
        print(f"  Confidence: {result.confidence:.0%}")
        print(f"  Reason: {result.reason}")

    print("\n" + "-" * 70)
    print("[STEP 2] Typing test text...")
    print("-" * 70)

    await mcp.run_task("type Vision-Based Focus Validation funktioniert!")
    await asyncio.sleep(0.5)

    # Final window check
    focus = await mcp.screen_focus()
    print(f"\n[DEBUG] Final active window: {focus.get('title', 'unknown')}")

    print("\n" + "=" * 70)
    print("  TEST COMPLETE!")
    print("  ")
    print("  Expected Result:")
    print("  - Word opened with blank document (not start screen)")
    print("  - Text 'Vision-Based Focus Validation funktioniert!' visible")
    print("=" * 70)

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(test())
