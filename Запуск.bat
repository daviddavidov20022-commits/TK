@echo off
cd /d "%~dp0"

echo ====================================
echo Starting Calculator TK (Деловые Линии и ПЭК)
echo ====================================

echo Opening site in browser...
start "" "http://localhost:3000"

echo.
echo Starting server...
echo IMPORTANT: Do NOT close this window while working with the application!
echo.

npm start

echo.
echo Server stopped.
pause

