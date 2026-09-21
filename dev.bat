@echo off
REM Wayfare Local Development Launcher
REM ==================================
REM Usage: dev.bat [option]
REM
REM Options:
REM   (no args)      Start emulators + API + app (same as --all)
REM   --all          Firebase emulators (Auth + Firestore), Cloudflare Worker, Vite app
REM   --emulators    Firebase Auth + Firestore emulators only (Emulator UI on :4000)
REM   --api          Cloudflare Worker via wrangler dev on :8787, pointed at the emulators
REM   --app          Vite app on :5173, pointed at the local Worker and the emulators
REM
REM Hot reload: Vite serves the app with HMR, so app changes appear the moment you save;
REM wrangler dev rebuilds the Worker on save, so API changes apply on the next request
REM (refresh the page). Emulator data lives in memory and resets when you stop it.
REM
REM Secrets: apps\api\.dev.vars (git-ignored) is created with empty placeholders on first
REM run. Fill GEMINI_API_KEY / OPENROUTER_API_KEY to exercise the LLM chain locally.

setlocal enabledelayedexpansion

for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "RED=!ESC![0;31m"
set "GREEN=!ESC![0;32m"
set "YELLOW=!ESC![1;33m"
set "BLUE=!ESC![0;34m"
set "MAGENTA=!ESC![0;35m"
set "NC=!ESC![0m"

set "FIREBASE_PROJECT=tripdesignai"
set "API_URL=http://127.0.0.1:8787"
set "APP_URL=http://localhost:5173"
set "AUTH_EMULATOR=127.0.0.1:9099"
set "FIRESTORE_EMULATOR=127.0.0.1:8080"

set START_APP=0
set START_API=0
set START_EMU=0

if "%~1"=="--all" (
    set START_APP=1
    set START_API=1
    set START_EMU=1
) else if "%~1"=="--app" (
    set START_APP=1
) else if "%~1"=="--api" (
    set START_API=1
) else if "%~1"=="--emulators" (
    set START_EMU=1
) else (
    echo !YELLOW![WARN]!NC! No flag provided, starting emulators + API + app.
    set START_APP=1
    set START_API=1
    set START_EMU=1
)

echo !BLUE![INFO]!NC! Checking tools...
where node >nul 2>&1
if errorlevel 1 (
    echo !RED![ERROR]!NC! node not found on PATH. Install Node 22 LTS ^(https://nodejs.org^).
    exit /b 1
)
where pnpm >nul 2>&1
if errorlevel 1 (
    echo !RED![ERROR]!NC! pnpm not found on PATH. Run: corepack enable ^&^& corepack prepare pnpm@latest --activate
    exit /b 1
)
if "!START_EMU!"=="1" (
    where java >nul 2>&1
    if errorlevel 1 (
        echo !RED![ERROR]!NC! java not found on PATH. The Firestore emulator needs a JDK: winget install EclipseAdoptium.Temurin.21.JDK
        exit /b 1
    )
)

echo !BLUE![INFO]!NC! Preparing dependencies...
if not exist node_modules (
    echo !GREEN![DEPS]!NC! Installing workspace dependencies...
    call pnpm install
    if errorlevel 1 (
        echo !RED![ERROR]!NC! pnpm install failed.
        exit /b 1
    )
)

if "!START_API!"=="1" (
    if not exist apps\api\.dev.vars (
        echo !YELLOW![INFO]!NC! Creating apps\api\.dev.vars with empty local secret placeholders.
        > apps\api\.dev.vars echo ALLOWED_ORIGIN=!APP_URL!
        >> apps\api\.dev.vars echo GEMINI_API_KEY=
        >> apps\api\.dev.vars echo OPENROUTER_API_KEY=
        >> apps\api\.dev.vars echo TAVILY_API_KEY=
        >> apps\api\.dev.vars echo ADMIN_UIDS=
        >> apps\api\.dev.vars echo FIREBASE_SERVICE_ACCOUNT=
    )
)

set CMD=npx -y concurrently
set NAMES=
set COLORS=
set COMMANDS=

if "!START_EMU!"=="1" (
    set NAMES=EMU
    set COLORS=green
    set COMMANDS="cd infra\firebase && pnpm exec firebase emulators:start --only auth,firestore --project !FIREBASE_PROJECT!"
)

if "!START_API!"=="1" (
    rem With emulators, the Worker verifies emulator tokens and talks to the local Firestore.
    rem Without them (--api alone) it uses the real project via .dev.vars, exactly like production.
    if "!START_EMU!"=="1" (
        set "API_CMD=cd apps\api && pnpm exec wrangler dev --port 8787 --var FIREBASE_AUTH_EMULATOR_HOST:!AUTH_EMULATOR! --var FIRESTORE_EMULATOR_HOST:!FIRESTORE_EMULATOR!"
    ) else (
        set "API_CMD=cd apps\api && pnpm exec wrangler dev --port 8787"
    )
    if "!NAMES!"=="" (
        set NAMES=API
        set COLORS=magenta
        set COMMANDS="!API_CMD!"
    ) else (
        set NAMES=!NAMES!,API
        set COLORS=!COLORS!,magenta
        set COMMANDS=!COMMANDS! "!API_CMD!"
    )
)

if "!START_APP!"=="1" (
    if "!START_EMU!"=="1" (
        set "APP_CMD=cd apps\web && set VITE_API_URL=!API_URL!&& set VITE_USE_EMULATORS=1&& pnpm exec vite --port 5173 --strictPort"
    ) else (
        set "APP_CMD=cd apps\web && set VITE_API_URL=!API_URL!&& set VITE_USE_EMULATORS=0&& pnpm exec vite --port 5173 --strictPort"
    )
    if "!NAMES!"=="" (
        set NAMES=APP
        set COLORS=blue
        set COMMANDS="!APP_CMD!"
    ) else (
        set NAMES=!NAMES!,APP
        set COLORS=!COLORS!,blue
        set COMMANDS=!COMMANDS! "!APP_CMD!"
    )
)

echo.
echo !BLUE![INFO]!NC! Services configured:
if "!START_EMU!"=="1" (
    echo !BLUE![INFO]!NC! Emulator UI:        http://127.0.0.1:4000
    echo !BLUE![INFO]!NC! Auth emulator:      http://!AUTH_EMULATOR!
    echo !BLUE![INFO]!NC! Firestore emulator: http://!FIRESTORE_EMULATOR!
    echo !YELLOW![INFO]!NC! Emulator data is in-memory; sign in with any Google account the emulator UI offers.
)
if "!START_API!"=="1" (
    echo !BLUE![INFO]!NC! API:                !API_URL!/health
    if "!START_EMU!"=="0" echo !YELLOW![WARN]!NC! API started without emulators: it will use the REAL Firebase project from apps\api\.dev.vars.
)
if "!START_APP!"=="1" (
    echo !BLUE![INFO]!NC! App:                !APP_URL!
    echo !BLUE![INFO]!NC! Hot reload: save a file and the app updates; API changes apply on the next request.
)
echo.

!CMD! -c "!COLORS!" -n "!NAMES!" !COMMANDS!

endlocal
