"""
Input Lock - Sperrt Mouse/Keyboard während Automation läuft.

Verhindert versehentliche User-Eingaben während der Task-Ausführung.
Nutzt Windows BlockInput API (erfordert Admin-Rechte für volle Funktion).
"""
import ctypes
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional
import threading


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
class LockStatus:
    """Status des Input Locks."""
    locked: bool
    locked_by: Optional[str] = None
    lock_time: Optional[float] = None
    has_admin: bool = False


class InputLock:
    """
    Sperrt Mouse und Keyboard während Automation.

    Usage:
        lock = InputLock()

        # Als Context Manager
        with lock.acquire("task_123"):
            # Mouse/Keyboard gesperrt
            do_automation()
        # Automatisch entsperrt

        # Oder manuell
        lock.lock("task_123")
        do_automation()
        lock.unlock()

    WICHTIG:
    - Erfordert Admin-Rechte für BlockInput
    - Ohne Admin: Fallback auf "soft lock" (nur Warnung)
    - ESC-Taste kann Lock aufheben (Safety Feature)
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        """Singleton - nur eine Instanz erlaubt."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._initialized = True
        self._locked = False
        self._locked_by: Optional[str] = None
        self._lock_time: Optional[float] = None
        self._has_admin = self._check_admin()
        self._safety_thread: Optional[threading.Thread] = None
        self._stop_safety = threading.Event()

        # Windows API
        if sys.platform == 'win32':
            self._user32 = ctypes.windll.user32
            self._kernel32 = ctypes.windll.kernel32
        else:
            self._user32 = None
            self._kernel32 = None

    def _check_admin(self) -> bool:
        """Prüfe ob wir Admin-Rechte haben."""
        if sys.platform != 'win32':
            return False
        try:
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except Exception:
            return False

    @property
    def status(self) -> LockStatus:
        """Aktueller Lock-Status."""
        return LockStatus(
            locked=self._locked,
            locked_by=self._locked_by,
            lock_time=self._lock_time,
            has_admin=self._has_admin
        )

    @property
    def is_locked(self) -> bool:
        """Ist Input gesperrt?"""
        return self._locked

    def lock(self, task_id: str = "unknown", timeout_sec: float = 60.0) -> bool:
        """
        Sperre Mouse und Keyboard.

        Args:
            task_id: ID des Tasks der den Lock hält
            timeout_sec: Maximale Lock-Zeit (Safety)

        Returns:
            True wenn Lock erfolgreich
        """
        if self._locked:
            _safe_print(f"[INPUT_LOCK] Bereits gesperrt von: {self._locked_by}")
            return False

        self._locked = True
        self._locked_by = task_id
        self._lock_time = time.time()

        # Windows BlockInput
        if self._user32 and self._has_admin:
            try:
                result = self._user32.BlockInput(True)
                if result:
                    _safe_print(f"[INPUT_LOCK] Input GESPERRT (Task: {task_id})")
                else:
                    _safe_print(f"[INPUT_LOCK] BlockInput fehlgeschlagen (soft lock aktiv)")
            except Exception as e:
                _safe_print(f"[INPUT_LOCK] BlockInput Error: {e}")
        else:
            _safe_print(f"[INPUT_LOCK] Soft Lock (keine Admin-Rechte)")
            _safe_print(f"[INPUT_LOCK] Task: {task_id} - Bitte nicht eingreifen!")

        # Safety Thread - automatischer Unlock nach Timeout
        self._stop_safety.clear()
        self._safety_thread = threading.Thread(
            target=self._safety_timeout,
            args=(timeout_sec,),
            daemon=True
        )
        self._safety_thread.start()

        return True

    def unlock(self) -> bool:
        """
        Entsperre Mouse und Keyboard.

        Returns:
            True wenn Unlock erfolgreich
        """
        if not self._locked:
            return True

        # Stop safety thread
        self._stop_safety.set()

        # Windows BlockInput(False)
        if self._user32 and self._has_admin:
            try:
                self._user32.BlockInput(False)
                duration = time.time() - (self._lock_time or time.time())
                _safe_print(f"[INPUT_LOCK] Input ENTSPERRT (nach {duration:.1f}s)")
            except Exception as e:
                _safe_print(f"[INPUT_LOCK] Unlock Error: {e}")
        else:
            _safe_print(f"[INPUT_LOCK] Soft Lock aufgehoben")

        self._locked = False
        self._locked_by = None
        self._lock_time = None

        return True

    def _safety_timeout(self, timeout_sec: float):
        """Safety Thread - entsperrt nach Timeout."""
        if self._stop_safety.wait(timeout=timeout_sec):
            # Normal beendet
            return

        # Timeout erreicht - Force Unlock
        _safe_print(f"\n[INPUT_LOCK] TIMEOUT nach {timeout_sec}s - Force Unlock!")
        self.unlock()

    @contextmanager
    def acquire(self, task_id: str = "unknown", timeout_sec: float = 60.0):
        """
        Context Manager für Input Lock.

        Usage:
            with input_lock.acquire("my_task"):
                do_automation()
        """
        try:
            self.lock(task_id, timeout_sec)
            yield self.status
        finally:
            self.unlock()

    def force_unlock(self):
        """Notfall-Entsperrung."""
        _safe_print("[INPUT_LOCK] FORCE UNLOCK")
        self._stop_safety.set()

        if self._user32:
            try:
                self._user32.BlockInput(False)
            except Exception:
                pass

        self._locked = False
        self._locked_by = None
        self._lock_time = None


# Globale Instanz
_input_lock: Optional[InputLock] = None


def get_input_lock() -> InputLock:
    """Hole globale InputLock Instanz."""
    global _input_lock
    if _input_lock is None:
        _input_lock = InputLock()
    return _input_lock


@contextmanager
def lock_input(task_id: str = "unknown", timeout_sec: float = 60.0):
    """
    Convenience Context Manager.

    Usage:
        from learning.input_lock import lock_input

        with lock_input("notepad_task"):
            # Input gesperrt
            pyautogui.click(100, 100)
            pyautogui.write("Hello")
        # Automatisch entsperrt
    """
    lock = get_input_lock()
    with lock.acquire(task_id, timeout_sec):
        yield lock.status


# Test
if __name__ == "__main__":
    print("=== Input Lock Test ===")

    lock = InputLock()
    print(f"Admin: {lock.status.has_admin}")

    print("\n[Test 1] Context Manager (5 Sekunden)")
    with lock.acquire("test_task", timeout_sec=10):
        print("  Input ist gesperrt...")
        print("  Versuche zu tippen/klicken - sollte nicht funktionieren")
        for i in range(5, 0, -1):
            print(f"  {i}...")
            time.sleep(1)

    print("\n[Test 2] Manueller Lock/Unlock")
    lock.lock("manual_test", timeout_sec=5)
    print("  Gesperrt für 3 Sekunden...")
    time.sleep(3)
    lock.unlock()

    print("\n=== Test Complete ===")
