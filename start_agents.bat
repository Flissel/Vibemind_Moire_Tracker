@echo off
echo ============================================
echo MoireTracker V2 - Desktop Agent Starter
echo ============================================
echo.

REM Wechsle zum Python-Verzeichnis
cd /d "%~dp0python"

REM Prüfe ob Python verfügbar ist
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python nicht gefunden!
    echo Bitte Python 3.10+ installieren.
    pause
    exit /b 1
)

echo [INFO] Starte Desktop Agent...
echo.
echo Hinweis: MoireServer sollte separat gestartet sein!
echo          start_server.bat oder npm run start
echo.
echo ============================================

REM Starte den Agent
python main.py %*

pause