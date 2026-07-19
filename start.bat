@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Hard Conversations Simulator
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on your PATH.
  echo Install the LTS version from https://nodejs.org/ then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies. This may take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo Starting local server at http://localhost:5173
echo A browser tab will open shortly. Close this window to stop the app.
echo.

REM Open the browser after a short delay so the dev server is ready.
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:5173"

call npm run dev

endlocal
