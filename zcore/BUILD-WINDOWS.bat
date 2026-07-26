@echo off
setlocal
title ZCore Windows Builder

where node >nul 2>nul
if errorlevel 1 (
  echo [ZCore] Chua cai Node.js 22 tro len.
  echo Tai Node.js tai https://nodejs.org/
  pause
  exit /b 1
)

echo [1/3] Cai dependencies...
call npm install
if errorlevel 1 goto :failed

echo [2/3] Chay kiem thu...
call npm test
if errorlevel 1 goto :failed

echo [3/3] Dong goi Setup va Portable EXE...
call npm run dist:win
if errorlevel 1 goto :failed

echo.
echo Hoan tat. Setup nam trong dist\setup, Portable nam trong dist\portable.
pause
exit /b 0

:failed
echo.
echo Build that bai. Xem loi phia tren.
pause
exit /b 1
