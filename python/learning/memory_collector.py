"""
Memory Collector - Zeichnet alle Interaktionen für Experience Learning auf.

Jede Aktion wird aufgezeichnet mit:
- Tool Name & Parameter
- Screen State vor/nach (Hash)
- Erfolg/Misserfolg
- Timing

Erfolgreiche Episodes werden als Training Data gespeichert.
"""
import json
import hashlib
import time
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, Any, List


def _safe_print(msg: str):
    """Print with encoding protection for Windows console."""
    try:
        print(msg)
    except (UnicodeEncodeError, UnicodeDecodeError, LookupError, Exception):
        try:
            safe_msg = msg.encode('ascii', 'replace').decode('ascii')
            print(safe_msg)
        except:
            print("[LOG] (encoding error)")


@dataclass
class ActionRecord:
    """Eine einzelne aufgezeichnete Aktion."""
    tool: str                           # z.B. "action_hotkey"
    params: Dict[str, Any]              # z.B. {"keys": "ctrl+s"}
    success: bool                       # Ob der Tool-Call erfolgreich war
    timestamp: str                      # ISO timestamp
    duration_ms: float                  # Wie lange hat es gedauert
    screen_state_before: Optional[str] = None  # Hash des Screen-States vor der Aktion
    screen_state_after: Optional[str] = None   # Hash des Screen-States nach der Aktion
    error: Optional[str] = None         # Fehlermeldung falls fehlgeschlagen
    result_summary: Optional[str] = None  # Kurze Zusammenfassung des Ergebnisses


@dataclass
class EpisodeRecord:
    """Eine komplette Episode (Task-Ausführung)."""
    episode_id: str                     # Unique ID
    app_context: str                    # Erkannte App (z.B. "notepad", "chrome")
    goal: str                           # Das ursprüngliche Goal/Task
    success: bool                       # Ob das Goal erreicht wurde
    start_time: str                     # ISO timestamp
    end_time: str                       # ISO timestamp
    total_duration_ms: float            # Gesamtdauer
    actions: List[ActionRecord] = field(default_factory=list)
    reward: float = 0.0                 # RL Reward: +1 success, -1 failure
    metadata: Dict[str, Any] = field(default_factory=dict)


class MemoryCollector:
    """
    Zeichnet alle Interaktionen auf für Experience Learning.

    Usage:
        collector = MemoryCollector()

        # Episode starten
        collector.start_episode("notepad", "schreibe Hello World")

        # Aktionen aufzeichnen
        collector.record_action(
            tool="action_type",
            params={"text": "Hello World"},
            success=True,
            duration_ms=150
        )

        # Episode beenden
        collector.end_episode(success=True)
    """

    def __init__(self, memory_dir: Optional[Path] = None):
        """
        Args:
            memory_dir: Verzeichnis für Memory-Speicherung.
                       Default: MoireTracker_v2/data/app_memories/
        """
        if memory_dir is None:
            memory_dir = Path(__file__).parent.parent.parent / "data" / "app_memories"

        self.memory_dir = Path(memory_dir)
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        self.current_episode: Optional[EpisodeRecord] = None
        self._episode_start_time: Optional[float] = None
        self._last_screen_hash: Optional[str] = None

    def start_episode(self, app_context: str, goal: str, metadata: Optional[Dict] = None):
        """
        Starte eine neue Episode.

        Args:
            app_context: Erkannte App (z.B. "notepad", "chrome", "unknown")
            goal: Das Goal/Task das ausgeführt werden soll
            metadata: Zusätzliche Metadaten
        """
        episode_id = f"ep_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hash(goal) % 10000:04d}"

        self.current_episode = EpisodeRecord(
            episode_id=episode_id,
            app_context=app_context,
            goal=goal,
            success=False,
            start_time=datetime.now().isoformat(),
            end_time="",
            total_duration_ms=0,
            actions=[],
            metadata=metadata or {}
        )

        self._episode_start_time = time.time()
        self._last_screen_hash = None

        _safe_print(f"[MEMORY] Episode started: {episode_id}")
        _safe_print(f"[MEMORY] App: {app_context}, Goal: {goal[:50]}...")

    def record_action(
        self,
        tool: str,
        params: Dict[str, Any],
        success: bool,
        duration_ms: float,
        screen_hash_before: Optional[str] = None,
        screen_hash_after: Optional[str] = None,
        error: Optional[str] = None,
        result_summary: Optional[str] = None
    ):
        """
        Zeichne eine Aktion auf.

        Args:
            tool: Name des MCP Tools (z.B. "action_hotkey")
            params: Parameter des Tool-Calls
            success: Ob der Call erfolgreich war
            duration_ms: Dauer in Millisekunden
            screen_hash_before: Hash des Screen-States vor der Aktion
            screen_hash_after: Hash des Screen-States nach der Aktion
            error: Fehlermeldung falls fehlgeschlagen
            result_summary: Kurze Zusammenfassung des Ergebnisses
        """
        if self.current_episode is None:
            _safe_print("[MEMORY] Warning: No active episode, starting anonymous episode")
            self.start_episode("unknown", "anonymous_task")

        # Wenn kein before hash gegeben, nutze den letzten after hash
        if screen_hash_before is None:
            screen_hash_before = self._last_screen_hash

        action = ActionRecord(
            tool=tool,
            params=params,
            success=success,
            timestamp=datetime.now().isoformat(),
            duration_ms=duration_ms,
            screen_state_before=screen_hash_before,
            screen_state_after=screen_hash_after,
            error=error,
            result_summary=result_summary
        )

        self.current_episode.actions.append(action)
        self._last_screen_hash = screen_hash_after

        status = "OK" if success else "FAIL"
        _safe_print(f"[MEMORY] [{status}] {tool}({self._format_params(params)})")

    def end_episode(self, success: bool, reward: Optional[float] = None):
        """
        Beende die aktuelle Episode und speichere sie.

        Args:
            success: Ob das Goal erreicht wurde
            reward: Optional RL Reward. Default: +1 für success, -1 für failure
        """
        if self.current_episode is None:
            _safe_print("[MEMORY] Warning: No active episode to end")
            return None

        self.current_episode.success = success
        self.current_episode.end_time = datetime.now().isoformat()
        self.current_episode.total_duration_ms = (time.time() - self._episode_start_time) * 1000
        self.current_episode.reward = reward if reward is not None else (1.0 if success else -1.0)

        # Speichere Episode
        self._save_episode(self.current_episode)

        # Stats ausgeben
        action_count = len(self.current_episode.actions)
        success_count = sum(1 for a in self.current_episode.actions if a.success)

        _safe_print(f"[MEMORY] Episode ended: {self.current_episode.episode_id}")
        _safe_print(f"[MEMORY] Success: {success}, Actions: {action_count}, Successful: {success_count}")
        _safe_print(f"[MEMORY] Duration: {self.current_episode.total_duration_ms:.0f}ms")

        episode = self.current_episode
        self.current_episode = None
        self._episode_start_time = None

        return episode

    def _save_episode(self, episode: EpisodeRecord):
        """Speichere Episode in App-spezifischer JSONL Datei."""
        app_dir = self.memory_dir / episode.app_context
        app_dir.mkdir(parents=True, exist_ok=True)

        interactions_file = app_dir / "interactions.jsonl"

        # Episode als dict für JSON
        episode_dict = asdict(episode)

        with open(interactions_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(episode_dict, ensure_ascii=False) + "\n")

        _safe_print(f"[MEMORY] Saved to: {interactions_file}")

    def _format_params(self, params: Dict[str, Any]) -> str:
        """Formatiere Parameter für Logging."""
        if not params:
            return ""

        parts = []
        for k, v in params.items():
            if isinstance(v, str) and len(v) > 20:
                v = v[:20] + "..."
            parts.append(f"{k}={v}")

        return ", ".join(parts)

    @staticmethod
    def compute_screen_hash(ocr_text: str) -> str:
        """
        Berechne einen Hash des Screen-States basierend auf OCR Text.

        Zwei ähnliche Screens haben ähnliche Hashes, sodass wir
        State-Transitions tracken können.
        """
        # Normalisiere: lowercase, entferne extra whitespace
        normalized = " ".join(ocr_text.lower().split())

        # MD5 hash (kurz genug für Logging)
        return hashlib.md5(normalized.encode()).hexdigest()[:12]

    def load_episodes(self, app_context: Optional[str] = None) -> List[EpisodeRecord]:
        """
        Lade alle gespeicherten Episodes.

        Args:
            app_context: Optional - nur Episodes für diese App laden

        Returns:
            Liste von EpisodeRecords
        """
        episodes = []

        if app_context:
            app_dirs = [self.memory_dir / app_context]
        else:
            app_dirs = [d for d in self.memory_dir.iterdir() if d.is_dir()]

        for app_dir in app_dirs:
            interactions_file = app_dir / "interactions.jsonl"
            if interactions_file.exists():
                with open(interactions_file, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            data = json.loads(line)
                            # Convert dicts back to dataclasses
                            actions = [ActionRecord(**a) for a in data.pop("actions", [])]
                            episode = EpisodeRecord(**data, actions=actions)
                            episodes.append(episode)

        return episodes

    def get_statistics(self, app_context: Optional[str] = None) -> Dict[str, Any]:
        """
        Berechne Statistiken über gesammelte Episodes.

        Returns:
            Dictionary mit Statistiken
        """
        episodes = self.load_episodes(app_context)

        if not episodes:
            return {"total_episodes": 0}

        successful = [e for e in episodes if e.success]

        total_actions = sum(len(e.actions) for e in episodes)
        successful_actions = sum(
            sum(1 for a in e.actions if a.success)
            for e in episodes
        )

        return {
            "total_episodes": len(episodes),
            "successful_episodes": len(successful),
            "success_rate": len(successful) / len(episodes) * 100,
            "total_actions": total_actions,
            "successful_actions": successful_actions,
            "action_success_rate": successful_actions / total_actions * 100 if total_actions > 0 else 0,
            "avg_actions_per_episode": total_actions / len(episodes),
            "avg_duration_ms": sum(e.total_duration_ms for e in episodes) / len(episodes),
            "apps": list(set(e.app_context for e in episodes))
        }


# Test
if __name__ == "__main__":
    collector = MemoryCollector()

    # Simuliere eine Episode
    collector.start_episode("notepad", "schreibe Hello World und speichere")

    collector.record_action(
        tool="action_hotkey",
        params={"keys": "win+r"},
        success=True,
        duration_ms=50,
        screen_hash_after="abc123"
    )

    collector.record_action(
        tool="action_type",
        params={"text": "notepad"},
        success=True,
        duration_ms=100,
        screen_hash_after="def456"
    )

    collector.record_action(
        tool="action_press",
        params={"key": "enter"},
        success=True,
        duration_ms=30,
        screen_hash_after="ghi789"
    )

    collector.record_action(
        tool="action_type",
        params={"text": "Hello World"},
        success=True,
        duration_ms=200,
        screen_hash_after="jkl012"
    )

    collector.record_action(
        tool="action_hotkey",
        params={"keys": "ctrl+s"},
        success=True,
        duration_ms=50,
        screen_hash_after="mno345"
    )

    episode = collector.end_episode(success=True)

    print("\n" + "="*50)
    print("STATISTICS:")
    print("="*50)
    stats = collector.get_statistics()
    for k, v in stats.items():
        print(f"  {k}: {v}")
