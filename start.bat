@echo off
setlocal

cd /d "%~dp0"

set "PORT=5173"
set "HOST=0.0.0.0"

echo Starting Marble Race Picker...
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Local URL:
echo   http://127.0.0.1:%PORT%/
echo.
echo Local network URLs:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { '  http://' + $_.IPAddress + ':%PORT%/' }"
echo.
echo Press Ctrl+C to stop the server.
echo.

call npm.cmd exec vite -- --host %HOST% --port %PORT%

echo.
echo Server stopped.
pause
