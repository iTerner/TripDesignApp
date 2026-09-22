@echo off
REM Wayfare destination scouting
REM ============================
REM Usage: scout.bat <slug> [options]
REM
REM The destination slug is the first argument. Flags may also come first
REM (scout.bat --status tuscany).
REM
REM Options:
REM   --backend agent|gemini   Intelligence backend (default: agent)
REM   --dry-run                Write work/<slug>/out instead of Firestore
REM   --status                 Print the status board and exit
REM   --report                 Print the run report
REM   --dedupe                 Re-run resolve and write pending merges
REM
REM --backend gemini requires GEMINI_API_KEY and TAVILY_API_KEY in the repo-root
REM .env. --backend agent needs no API keys. This script does not start emulators.
REM A slug with no work\<slug>\00-destination.json is an unknown destination:
REM the script exits 2 before pnpm, so nothing talks to the network.
REM
REM The root "pnpm scout" script already ends in --. Do not add another --
REM or commander receives it as an extra argument.

setlocal enabledelayedexpansion

cd /d "%~dp0"

for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "RED=!ESC![0;31m"
set "GREEN=!ESC![0;32m"
set "YELLOW=!ESC![1;33m"
set "BLUE=!ESC![0;34m"
set "MAGENTA=!ESC![0;35m"
set "NC=!ESC![0m"

echo !BLUE![INFO]!NC! Checking tools...
where node >nul 2>&1
if errorlevel 1 goto missing_node
where pnpm >nul 2>&1
if errorlevel 1 goto missing_pnpm

set "BACKEND=agent"
set "SLUG="

:parse_args
if "%~1"=="" goto parsed
if /I "%~1"=="--backend" (
    if "%~2"=="" goto bad_backend
    set "BACKEND=%~2"
    shift
    shift
    goto parse_args
)
if /I "%~1"=="--stage" goto skip_valued
if /I "%~1"=="--from" goto skip_valued
if /I "%~1"=="--budget" goto skip_valued
if /I "%~1"=="--dry-run" goto skip_flag
if /I "%~1"=="--status" goto skip_flag
if /I "%~1"=="--report" goto skip_flag
if /I "%~1"=="--dedupe" goto skip_flag
if /I "%~1"=="--resume" goto skip_flag
if /I "%~1"=="--force" goto skip_flag
set "ARG=%~1"
if "!ARG:~0,2!"=="--" (
    shift
    goto parse_args
)
if not defined SLUG set "SLUG=%~1"
shift
goto parse_args

:skip_valued
shift
shift
goto parse_args

:skip_flag
shift
goto parse_args

:parsed
if /I not "!BACKEND!"=="agent" if /I not "!BACKEND!"=="gemini" goto bad_backend
if /I "!BACKEND!"=="gemini" goto gemini_keys
goto slug_check

:gemini_keys
call :require_key GEMINI_API_KEY
if errorlevel 1 exit /b 2
call :require_key TAVILY_API_KEY
if errorlevel 1 exit /b 2

:slug_check
if not defined SLUG goto missing_slug
set "UNSAFE="
for /f "delims=abcdefghijklmnopqrstuvwxyz0123456789-" %%C in ("!SLUG!") do set "UNSAFE=1"
if defined UNSAFE goto run_scout
if not exist "work\!SLUG!\00-destination.json" goto unknown_dest

:run_scout
if exist ".env" call :load_env
call pnpm scout %*
exit /b %ERRORLEVEL%

:missing_node
echo !RED![ERROR]!NC! node not found on PATH. Install Node 22 LTS ^(https://nodejs.org^).
exit /b 1

:missing_pnpm
echo !RED![ERROR]!NC! pnpm not found on PATH. Run: corepack enable ^&^& corepack prepare pnpm@latest --activate
exit /b 1

:missing_slug
echo !RED![ERROR]!NC! destination slug is required
exit /b 2

:unknown_dest
echo !RED![ERROR]!NC! unknown destination "!SLUG!"
exit /b 2

:bad_backend
echo !RED![ERROR]!NC! --backend must be agent or gemini
exit /b 2

:require_key
set "NEED=%~1"
set "HAVE="
if not exist ".env" goto key_missing
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if "%%A"=="!NEED!" set "HAVE=%%B"
)
if not defined HAVE goto key_missing
if "!HAVE!"=="" goto key_missing
exit /b 0

:key_missing
echo !RED![ERROR]!NC! .env lacks !NEED!
exit /b 1

:load_env
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%B"=="" set "%%A=%%B"
)
exit /b 0
