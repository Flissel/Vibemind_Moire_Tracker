@echo off
REM ============================================
REM MoireTracker_v2 - gRPC HTTP Bridge Starter
REM ============================================
REM Startet den Python HTTP Bridge Server auf Port 8766
REM Dieser verbindet TypeScript MoireServer mit Python gRPC Workers

echo.
echo ========================================
echo  MoireTracker_v2 - gRPC HTTP Bridge
echo ========================================
echo.

REM Check Python
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python nicht gefunden! Bitte Python installieren.
    pause
    exit /b 1
)

REM Navigate to python directory
cd /d "%~dp0python"

REM Load .env if exists (from parent MoireTracker_v2 directory)
if exist "..\python\.env" (
    echo [INFO] Loading ..\python\.env file...
    for /f "tokens=*" %%a in ('type "..\python\.env" ^| findstr /v "^#"') do set %%a
)
if exist "..\.env" (
    echo [INFO] Loading ..\.env file...
    for /f "tokens=*" %%a in ('type "..\.env" ^| findstr /v "^#"') do set %%a
)

REM Check OPENROUTER_API_KEY
if "%OPENROUTER_API_KEY%"=="" (
    echo [WARNING] OPENROUTER_API_KEY nicht gesetzt!
    echo           LLM Classification wird nicht funktionieren.
    echo           Bitte setzen Sie die Variable in .env oder als Umgebungsvariable.
    echo.
)

REM Install requirements if needed
echo [INFO] Checking dependencies...
pip show aiohttp >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Installing requirements...
    pip install -r requirements.txt
)

echo.
echo [INFO] Starting HTTP Bridge Server on port 8766...
echo [INFO] Endpoints:
echo        - GET  /status              - Host Status
echo        - POST /classify_batch      - Batch Classification
echo        - POST /classify_single     - Single Classification
echo        - GET  /active_learning/queue - AL Queue
echo        - GET  /stats               - Detailed Stats
echo.
echo [INFO] Press Ctrl+C to stop
echo.

REM Start the HTTP Bridge (use worker_bridge.http_bridge)
python -c "import asyncio; from worker_bridge.http_bridge import run_http_bridge; asyncio.run(run_http_bridge())"

echo.
echo [INFO] HTTP Bridge stopped.
pause