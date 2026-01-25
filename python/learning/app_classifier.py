"""
App Classifier - Erkennt Apps aus Fenstertiteln.

Dynamische App-Erkennung für app-unabhängiges Learning.
"""
import re
from typing import Optional, Dict, Tuple


class AppClassifier:
    """
    Erkennt Apps aus Fenstertiteln für dynamisches Learning.

    Das System lernt app-spezifische Patterns, aber die Klassifikation
    erlaubt auch das Gruppieren ähnlicher Apps (z.B. alle Browser).
    """

    # App Patterns: (regex, app_name, category)
    PATTERNS = [
        # === TEXT EDITOREN ===
        (r"notepad", "notepad", "text_editor"),
        (r"notepad\+\+", "notepadpp", "text_editor"),
        (r"sublime\s*text", "sublime", "text_editor"),
        (r"visual\s*studio\s*code|vscode|\.code", "vscode", "code_editor"),

        # === OFFICE ===
        (r"word|\.docx?|winword", "word", "word_processor"),
        (r"excel|\.xlsx?", "excel", "spreadsheet"),
        (r"powerpoint|\.pptx?", "powerpoint", "presentation"),
        (r"outlook", "outlook", "email"),
        (r"onenote", "onenote", "notes"),
        (r"libreoffice\s*writer", "libreoffice_writer", "word_processor"),
        (r"libreoffice\s*calc", "libreoffice_calc", "spreadsheet"),

        # === BROWSER ===
        (r"google\s*chrome|chrome", "chrome", "web_browser"),
        (r"mozilla\s*firefox|firefox", "firefox", "web_browser"),
        (r"microsoft\s*edge|edge", "edge", "web_browser"),
        (r"brave", "brave", "web_browser"),
        (r"opera", "opera", "web_browser"),

        # === FILE MANAGEMENT ===
        (r"explorer|dieser\s*pc|this\s*pc|documents|downloads", "explorer", "file_manager"),
        (r"total\s*commander", "totalcmd", "file_manager"),
        (r"7-?zip", "7zip", "archiver"),

        # === KOMMUNIKATION ===
        (r"microsoft\s*teams|teams", "teams", "communication"),
        (r"slack", "slack", "communication"),
        (r"discord", "discord", "communication"),
        (r"zoom", "zoom", "video_call"),
        (r"telegram", "telegram", "messaging"),
        (r"whatsapp", "whatsapp", "messaging"),
        (r"skype", "skype", "communication"),

        # === MEDIA ===
        (r"vlc", "vlc", "media_player"),
        (r"spotify", "spotify", "music"),
        (r"windows\s*media", "wmp", "media_player"),
        (r"fotos|photos", "photos", "image_viewer"),

        # === GRAFIK ===
        (r"paint(?!\.net)", "paint", "image_editor"),
        (r"paint\.net", "paintnet", "image_editor"),
        (r"gimp", "gimp", "image_editor"),
        (r"photoshop", "photoshop", "image_editor"),

        # === ENTWICKLUNG ===
        (r"visual\s*studio(?!\s*code)", "visualstudio", "ide"),
        (r"pycharm", "pycharm", "ide"),
        (r"intellij", "intellij", "ide"),
        (r"eclipse", "eclipse", "ide"),
        (r"android\s*studio", "android_studio", "ide"),

        # === TERMINAL ===
        (r"cmd\.exe|command\s*prompt|eingabeaufforderung", "cmd", "terminal"),
        (r"powershell", "powershell", "terminal"),
        (r"windows\s*terminal", "terminal", "terminal"),
        (r"git\s*bash", "gitbash", "terminal"),

        # === SYSTEM ===
        (r"task\s*manager|task-manager", "taskmgr", "system"),
        (r"control\s*panel|systemsteuerung", "control", "system"),
        (r"settings|einstellungen", "settings", "system"),
        (r"calculator|rechner|calc", "calc", "utility"),
    ]

    # Executable → App mapping (für Run Dialog)
    EXECUTABLES = {
        "notepad": "notepad",
        "winword": "word",
        "excel": "excel",
        "powerpnt": "powerpoint",
        "outlook": "outlook",
        "onenote": "onenote",
        "chrome": "chrome",
        "firefox": "firefox",
        "msedge": "edge",
        "explorer": "explorer",
        "cmd": "cmd",
        "powershell": "powershell",
        "wt": "terminal",
        "calc": "calc",
        "mspaint": "paint",
        "code": "vscode",
        "devenv": "visualstudio",
        "pycharm": "pycharm",
        "idea": "intellij",
        "taskmgr": "taskmgr",
        "control": "control",
        "vlc": "vlc",
        "spotify": "spotify",
    }

    def __init__(self):
        # Compiled regex patterns für Performance
        self._compiled_patterns = [
            (re.compile(pattern, re.IGNORECASE), app_name, category)
            for pattern, app_name, category in self.PATTERNS
        ]

    def classify(self, window_title: str) -> Tuple[str, str]:
        """
        Klassifiziere App aus Fenstertitel.

        Args:
            window_title: Der Fenstertitel

        Returns:
            Tuple (app_name, category)
            z.B. ("notepad", "text_editor") oder ("unknown", "unknown")
        """
        if not window_title:
            return ("unknown", "unknown")

        for regex, app_name, category in self._compiled_patterns:
            if regex.search(window_title):
                return (app_name, category)

        return ("unknown", "unknown")

    def classify_executable(self, executable: str) -> Tuple[str, str]:
        """
        Klassifiziere App aus Executable-Name.

        Args:
            executable: Der Executable-Name (z.B. "notepad", "winword")

        Returns:
            Tuple (app_name, category)
        """
        exe_lower = executable.lower().replace(".exe", "")

        if exe_lower in self.EXECUTABLES:
            app_name = self.EXECUTABLES[exe_lower]
            # Finde Kategorie
            for pattern, name, category in self.PATTERNS:
                if name == app_name:
                    return (app_name, category)
            return (app_name, "unknown")

        return ("unknown", "unknown")

    def get_app_info(self, window_title: str) -> Dict:
        """
        Ausführliche App-Info aus Fenstertitel.

        Returns:
            Dictionary mit app_name, category, matched_pattern, confidence
        """
        if not window_title:
            return {
                "app_name": "unknown",
                "category": "unknown",
                "matched_pattern": None,
                "confidence": 0.0,
                "window_title": window_title
            }

        for regex, app_name, category in self._compiled_patterns:
            match = regex.search(window_title)
            if match:
                return {
                    "app_name": app_name,
                    "category": category,
                    "matched_pattern": match.group(),
                    "confidence": 1.0,
                    "window_title": window_title
                }

        return {
            "app_name": "unknown",
            "category": "unknown",
            "matched_pattern": None,
            "confidence": 0.0,
            "window_title": window_title
        }

    @property
    def known_apps(self) -> list:
        """Liste aller bekannten Apps."""
        return list(set(app_name for _, app_name, _ in self.PATTERNS))

    @property
    def known_categories(self) -> list:
        """Liste aller bekannten Kategorien."""
        return list(set(category for _, _, category in self.PATTERNS))


# Test
if __name__ == "__main__":
    classifier = AppClassifier()

    test_titles = [
        "*Unbenannt – Notepad",
        "Document1 - Microsoft Word",
        "Sheet1 - Excel",
        "Google Chrome",
        "GitHub - Mozilla Firefox",
        "Moire_tracker_v1 - Visual Studio Code",
        "Dieser PC",
        "Windows PowerShell",
        "Task-Manager",
        "Some Random Window Title",
        "",
    ]

    print("App Classification Test")
    print("=" * 60)

    for title in test_titles:
        info = classifier.get_app_info(title)
        print(f"\nTitle: '{title}'")
        print(f"  App: {info['app_name']}")
        print(f"  Category: {info['category']}")
        print(f"  Matched: {info['matched_pattern']}")

    print("\n" + "=" * 60)
    print(f"Known Apps: {len(classifier.known_apps)}")
    print(f"Known Categories: {len(classifier.known_categories)}")
