"""
App Explorer - Automatische UI-Erkundung für Apps.

Erkundet eine App und sammelt UI-Wissen:
- Menüs und deren Positionen
- Buttons und klickbare Elemente
- Textfelder und Eingabebereiche
- Keyboard Shortcuts

Dieses Wissen wird für späteres Learning verwendet.
"""
import json
import asyncio
import time
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, Any, List, Tuple


@dataclass
class UIElement:
    """Ein UI-Element mit Position und Eigenschaften."""
    element_type: str           # "button", "menu", "input", "text", "icon"
    text: str                   # Sichtbarer Text
    x: int                      # X-Koordinate
    y: int                      # Y-Koordinate
    width: Optional[int] = None
    height: Optional[int] = None
    confidence: float = 1.0
    parent: Optional[str] = None  # z.B. "menu_bar", "toolbar"


@dataclass
class AppUIKnowledge:
    """Gesammeltes UI-Wissen über eine App."""
    app_name: str
    app_executable: str
    last_updated: str
    window_title: str = ""
    window_bounds: Dict[str, int] = field(default_factory=dict)

    # UI-Elemente gruppiert
    menu_bar: List[UIElement] = field(default_factory=list)
    toolbar: List[UIElement] = field(default_factory=list)
    buttons: List[UIElement] = field(default_factory=list)
    inputs: List[UIElement] = field(default_factory=list)
    text_areas: List[UIElement] = field(default_factory=list)
    icons: List[UIElement] = field(default_factory=list)

    # Bekannte Shortcuts (aus Exploration oder hardcoded)
    shortcuts: Dict[str, str] = field(default_factory=dict)

    # Exploration Statistiken
    exploration_count: int = 0
    total_elements_found: int = 0


class AppExplorer:
    """
    Erkundet Apps automatisch und sammelt UI-Wissen.

    Usage:
        explorer = AppExplorer()

        # App erkunden
        knowledge = await explorer.explore_app("notepad")

        # Oder nur scannen ohne App zu öffnen
        knowledge = await explorer.scan_current_app()
    """

    # Bekannte App-Executables
    APP_EXECUTABLES = {
        "notepad": "notepad",
        "word": "winword",
        "excel": "excel",
        "powerpoint": "powerpnt",
        "chrome": "chrome",
        "firefox": "firefox",
        "edge": "msedge",
        "explorer": "explorer",
        "calc": "calc",
        "paint": "mspaint",
        "cmd": "cmd",
        "powershell": "powershell",
        "vscode": "code",
    }

    # Standard-Shortcuts pro App
    KNOWN_SHORTCUTS = {
        "notepad": {
            "new": "ctrl+n",
            "open": "ctrl+o",
            "save": "ctrl+s",
            "save_as": "ctrl+shift+s",
            "print": "ctrl+p",
            "find": "ctrl+f",
            "replace": "ctrl+h",
            "select_all": "ctrl+a",
            "cut": "ctrl+x",
            "copy": "ctrl+c",
            "paste": "ctrl+v",
            "undo": "ctrl+z",
            "close": "alt+f4",
        },
        "word": {
            "new": "ctrl+n",
            "open": "ctrl+o",
            "save": "ctrl+s",
            "save_as": "f12",
            "print": "ctrl+p",
            "find": "ctrl+f",
            "replace": "ctrl+h",
            "select_all": "ctrl+a",
            "bold": "ctrl+b",
            "italic": "ctrl+i",
            "underline": "ctrl+u",
            "undo": "ctrl+z",
            "redo": "ctrl+y",
        },
        "chrome": {
            "new_tab": "ctrl+t",
            "close_tab": "ctrl+w",
            "new_window": "ctrl+n",
            "reopen_tab": "ctrl+shift+t",
            "address_bar": "ctrl+l",
            "find": "ctrl+f",
            "refresh": "f5",
            "back": "alt+left",
            "forward": "alt+right",
            "bookmark": "ctrl+d",
            "history": "ctrl+h",
            "downloads": "ctrl+j",
        },
        "explorer": {
            "new_folder": "ctrl+shift+n",
            "rename": "f2",
            "delete": "delete",
            "copy": "ctrl+c",
            "paste": "ctrl+v",
            "cut": "ctrl+x",
            "select_all": "ctrl+a",
            "properties": "alt+enter",
            "address_bar": "ctrl+l",
            "search": "ctrl+f",
            "refresh": "f5",
        },
    }

    def __init__(self, knowledge_dir: Optional[Path] = None):
        """
        Args:
            knowledge_dir: Verzeichnis für UI-Wissen.
                          Default: MoireTracker_v2/data/app_memories/
        """
        if knowledge_dir is None:
            knowledge_dir = Path(__file__).parent.parent.parent / "data" / "app_memories"

        self.knowledge_dir = Path(knowledge_dir)
        self.knowledge_dir.mkdir(parents=True, exist_ok=True)

        # MCP Tools werden via subprocess aufgerufen
        self._mcp_available = False

    async def explore_app(self, app_name: str, open_app: bool = True) -> AppUIKnowledge:
        """
        Erkunde eine App vollständig.

        Args:
            app_name: Name der App (z.B. "notepad", "chrome")
            open_app: Ob die App geöffnet werden soll (default: True)

        Returns:
            AppUIKnowledge mit allen gefundenen UI-Elementen
        """
        app_lower = app_name.lower()
        executable = self.APP_EXECUTABLES.get(app_lower, app_lower)

        print(f"[EXPLORER] Exploring app: {app_name} (exe: {executable})")

        # 1. App öffnen wenn gewünscht
        if open_app:
            await self._open_app(executable)
            await asyncio.sleep(2)  # Warten bis App geladen

        # 2. Fensterinfo holen
        window_info = await self._get_window_info()

        # 3. Screen scannen
        scan_result = await self._scan_screen()

        # 4. UI-Elemente extrahieren
        knowledge = self._extract_ui_elements(
            app_name=app_lower,
            executable=executable,
            window_info=window_info,
            scan_result=scan_result
        )

        # 5. Bekannte Shortcuts hinzufügen
        if app_lower in self.KNOWN_SHORTCUTS:
            knowledge.shortcuts = self.KNOWN_SHORTCUTS[app_lower].copy()

        # 6. Speichern
        self._save_knowledge(knowledge)

        print(f"[EXPLORER] Found {knowledge.total_elements_found} elements")
        print(f"[EXPLORER] Saved to: {self.knowledge_dir / app_lower / 'ui_elements.json'}")

        return knowledge

    async def scan_current_app(self) -> AppUIKnowledge:
        """
        Scanne die aktuell aktive App ohne sie neu zu öffnen.

        Returns:
            AppUIKnowledge mit gefundenen UI-Elementen
        """
        # Fensterinfo holen um App zu identifizieren
        window_info = await self._get_window_info()
        app_name = self._detect_app_from_title(window_info.get("title", ""))

        print(f"[EXPLORER] Scanning current app: {app_name}")

        # Screen scannen
        scan_result = await self._scan_screen()

        # UI-Elemente extrahieren
        knowledge = self._extract_ui_elements(
            app_name=app_name,
            executable="unknown",
            window_info=window_info,
            scan_result=scan_result
        )

        # Bekannte Shortcuts hinzufügen
        if app_name in self.KNOWN_SHORTCUTS:
            knowledge.shortcuts = self.KNOWN_SHORTCUTS[app_name].copy()

        # Speichern
        self._save_knowledge(knowledge)

        return knowledge

    async def _open_app(self, executable: str):
        """Öffne App via Run Dialog."""
        try:
            import pyautogui

            # Win+R für Run Dialog
            pyautogui.hotkey('win', 'r')
            await asyncio.sleep(0.5)

            # Executable eingeben
            pyautogui.typewrite(executable, interval=0.05)
            await asyncio.sleep(0.2)

            # Enter drücken
            pyautogui.press('enter')

            print(f"[EXPLORER] Opened: {executable}")

        except ImportError:
            print("[EXPLORER] pyautogui not available, cannot open app")

    async def _get_window_info(self) -> Dict[str, Any]:
        """Hole Info über aktives Fenster."""
        try:
            import pygetwindow as gw

            active = gw.getActiveWindow()
            if active:
                return {
                    "title": active.title,
                    "x": active.left,
                    "y": active.top,
                    "width": active.width,
                    "height": active.height
                }
        except ImportError:
            pass
        except Exception as e:
            print(f"[EXPLORER] Window info error: {e}")

        return {"title": "Unknown", "x": 0, "y": 0, "width": 1920, "height": 1080}

    async def _scan_screen(self) -> Dict[str, Any]:
        """Scanne Screen mit OCR und Element Detection."""
        result = {
            "text_lines": [],
            "elements": [],
            "regions": []
        }

        try:
            import pyautogui
            from PIL import Image

            # Screenshot machen
            screenshot = pyautogui.screenshot()
            width, height = screenshot.size

            result["width"] = width
            result["height"] = height

            # OCR versuchen
            try:
                import pytesseract

                # OCR auf Screenshot
                data = pytesseract.image_to_data(screenshot, output_type=pytesseract.Output.DICT)

                # Text-Elemente extrahieren
                for i, text in enumerate(data['text']):
                    if text.strip():
                        result["text_lines"].append({
                            "text": text,
                            "x": data['left'][i],
                            "y": data['top'][i],
                            "width": data['width'][i],
                            "height": data['height'][i],
                            "confidence": data['conf'][i] / 100.0
                        })

                print(f"[EXPLORER] OCR found {len(result['text_lines'])} text elements")

            except ImportError:
                print("[EXPLORER] pytesseract not available")
            except Exception as e:
                print(f"[EXPLORER] OCR error: {e}")

        except ImportError:
            print("[EXPLORER] pyautogui not available")
        except Exception as e:
            print(f"[EXPLORER] Screen scan error: {e}")

        return result

    def _extract_ui_elements(
        self,
        app_name: str,
        executable: str,
        window_info: Dict[str, Any],
        scan_result: Dict[str, Any]
    ) -> AppUIKnowledge:
        """Extrahiere UI-Elemente aus Scan-Ergebnis."""

        knowledge = AppUIKnowledge(
            app_name=app_name,
            app_executable=executable,
            last_updated=datetime.now().isoformat(),
            window_title=window_info.get("title", ""),
            window_bounds={
                "x": window_info.get("x", 0),
                "y": window_info.get("y", 0),
                "width": window_info.get("width", 0),
                "height": window_info.get("height", 0)
            }
        )

        # Text-Elemente klassifizieren
        text_elements = scan_result.get("text_lines", [])
        window_y = window_info.get("y", 0)
        window_height = window_info.get("height", 1080)

        for elem in text_elements:
            text = elem.get("text", "").strip()
            if not text:
                continue

            x = elem.get("x", 0)
            y = elem.get("y", 0)
            width = elem.get("width", 0)
            height = elem.get("height", 0)
            conf = elem.get("confidence", 1.0)

            # Relative Position zum Fenster
            rel_y = y - window_y

            # Klassifikation basierend auf Position und Text
            ui_elem = UIElement(
                element_type="text",
                text=text,
                x=x,
                y=y,
                width=width,
                height=height,
                confidence=conf
            )

            # Menü-Bar erkennen (obere 50 Pixel)
            if rel_y < 50:
                # Typische Menü-Einträge
                if text.lower() in ["file", "edit", "view", "format", "help",
                                    "datei", "bearbeiten", "ansicht", "format", "hilfe",
                                    "tools", "window", "options"]:
                    ui_elem.element_type = "menu"
                    ui_elem.parent = "menu_bar"
                    knowledge.menu_bar.append(ui_elem)
                    continue

            # Toolbar erkennen (50-100 Pixel)
            if 50 <= rel_y < 100:
                ui_elem.parent = "toolbar"
                knowledge.toolbar.append(ui_elem)
                continue

            # Button-artige Texte erkennen
            if text.lower() in ["ok", "cancel", "apply", "close", "save", "open",
                               "abbrechen", "übernehmen", "schließen", "speichern", "öffnen",
                               "yes", "no", "ja", "nein", "browse", "durchsuchen"]:
                ui_elem.element_type = "button"
                knowledge.buttons.append(ui_elem)
                continue

            # Restliche als Text
            knowledge.text_areas.append(ui_elem)

        # Statistiken
        knowledge.exploration_count = 1
        knowledge.total_elements_found = (
            len(knowledge.menu_bar) +
            len(knowledge.toolbar) +
            len(knowledge.buttons) +
            len(knowledge.inputs) +
            len(knowledge.text_areas) +
            len(knowledge.icons)
        )

        return knowledge

    def _detect_app_from_title(self, title: str) -> str:
        """Erkenne App aus Fenstertitel."""
        title_lower = title.lower()

        patterns = [
            ("notepad", "notepad"),
            ("word", "word"),
            ("excel", "excel"),
            ("powerpoint", "powerpoint"),
            ("chrome", "chrome"),
            ("firefox", "firefox"),
            ("edge", "edge"),
            ("explorer", "explorer"),
            ("visual studio code", "vscode"),
            ("code", "vscode"),
        ]

        for pattern, app in patterns:
            if pattern in title_lower:
                return app

        return "unknown"

    def _save_knowledge(self, knowledge: AppUIKnowledge):
        """Speichere UI-Wissen als JSON."""
        app_dir = self.knowledge_dir / knowledge.app_name
        app_dir.mkdir(parents=True, exist_ok=True)

        # Konvertiere zu dict
        data = asdict(knowledge)

        # Speichern
        output_file = app_dir / "ui_elements.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def load_knowledge(self, app_name: str) -> Optional[AppUIKnowledge]:
        """Lade gespeichertes UI-Wissen."""
        app_dir = self.knowledge_dir / app_name
        knowledge_file = app_dir / "ui_elements.json"

        if not knowledge_file.exists():
            return None

        try:
            with open(knowledge_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            # Konvertiere Listen zu UIElement-Objekten
            for field_name in ["menu_bar", "toolbar", "buttons", "inputs", "text_areas", "icons"]:
                if field_name in data:
                    data[field_name] = [UIElement(**elem) for elem in data[field_name]]

            return AppUIKnowledge(**data)

        except Exception as e:
            print(f"[EXPLORER] Error loading knowledge: {e}")
            return None

    def list_explored_apps(self) -> List[str]:
        """Liste alle erkundeten Apps."""
        apps = []
        if self.knowledge_dir.exists():
            for app_dir in self.knowledge_dir.iterdir():
                if app_dir.is_dir():
                    if (app_dir / "ui_elements.json").exists():
                        apps.append(app_dir.name)
        return sorted(apps)

    def get_element_at_position(self, app_name: str, x: int, y: int) -> Optional[UIElement]:
        """Finde UI-Element an Position."""
        knowledge = self.load_knowledge(app_name)
        if not knowledge:
            return None

        # Suche in allen Element-Listen
        all_elements = (
            knowledge.menu_bar +
            knowledge.toolbar +
            knowledge.buttons +
            knowledge.inputs +
            knowledge.text_areas +
            knowledge.icons
        )

        for elem in all_elements:
            if elem.width and elem.height:
                if (elem.x <= x <= elem.x + elem.width and
                    elem.y <= y <= elem.y + elem.height):
                    return elem

        return None

    def find_element_by_text(self, app_name: str, text: str) -> List[UIElement]:
        """Finde UI-Elemente mit bestimmtem Text."""
        knowledge = self.load_knowledge(app_name)
        if not knowledge:
            return []

        text_lower = text.lower()
        matches = []

        all_elements = (
            knowledge.menu_bar +
            knowledge.toolbar +
            knowledge.buttons +
            knowledge.inputs +
            knowledge.text_areas +
            knowledge.icons
        )

        for elem in all_elements:
            if text_lower in elem.text.lower():
                matches.append(elem)

        return matches


# Test
if __name__ == "__main__":
    async def test_explorer():
        explorer = AppExplorer()

        print("=" * 60)
        print("APP EXPLORER TEST")
        print("=" * 60)

        # Liste bereits erkundete Apps
        explored = explorer.list_explored_apps()
        print(f"\nBereits erkundete Apps: {explored}")

        # Scanne aktuelle App
        print("\n[TEST] Scanne aktuelle App...")
        knowledge = await explorer.scan_current_app()

        print(f"\nApp: {knowledge.app_name}")
        print(f"Window: {knowledge.window_title}")
        print(f"Elements found: {knowledge.total_elements_found}")
        print(f"  - Menu items: {len(knowledge.menu_bar)}")
        print(f"  - Toolbar items: {len(knowledge.toolbar)}")
        print(f"  - Buttons: {len(knowledge.buttons)}")
        print(f"  - Text areas: {len(knowledge.text_areas)}")
        print(f"  - Shortcuts: {len(knowledge.shortcuts)}")

        if knowledge.menu_bar:
            print("\nMenu Bar:")
            for item in knowledge.menu_bar[:5]:
                print(f"  - {item.text} at ({item.x}, {item.y})")

        if knowledge.shortcuts:
            print("\nKnown Shortcuts:")
            for action, keys in list(knowledge.shortcuts.items())[:5]:
                print(f"  - {action}: {keys}")

    asyncio.run(test_explorer())
