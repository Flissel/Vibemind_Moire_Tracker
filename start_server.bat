@echo off
echo ===========================================
echo   MoireTracker v2 - TypeScript Server
echo ===========================================
echo.

cd /d "%~dp0"

echo [1/2] Pruefe Node.js Installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js nicht installiert!
    echo Bitte installiere Node.js von https://nodejs.org
    pause
    exit /b 1
)

echo [2/2] Starte MoireServer auf Port 8765...
echo.

:: Prüfe ob dist existiert
if not exist "dist\server\moire-server.js" (
    echo Build nicht gefunden, baue TypeScript...
    call npm run build
    if errorlevel 1 (
        echo Build fehlgeschlagen! Versuche Dev-Modus...
        npx ts-node src/server/moire-server.ts
        exit /b
    )
)

:: Starte Server
node bin/moire-server.js