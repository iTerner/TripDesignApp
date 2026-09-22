@echo off
REM Wayfare Production Deployment Script
REM ====================================
REM Usage: prod.bat [options]
REM
REM Options:
REM   (no args)          Show interactive menu
REM   --all              Deploy Worker (API), web app (Hosting) and Firestore rules
REM   --app              Build and deploy the web app (Firebase Hosting)
REM   --api              Deploy the Cloudflare Worker (wrangler deploy) + sync secrets
REM   --rules            Deploy Firestore rules
REM   --build-only       Build only, don't deploy
REM
REM Examples:
REM   prod.bat --app --rules        Hosting + rules
REM   prod.bat --api                Worker only, secrets synced from .env
REM
REM Preflight (always, before any build): the git working tree must be clean, then
REM pnpm typecheck, pnpm lint, pnpm test and pnpm audit --audit-level high must pass.
REM Any failure aborts the deploy.
REM
REM When the API is deployed, the five Worker secrets (GEMINI_API_KEY, OPENROUTER_API_KEY,
REM TAVILY_API_KEY, ADMIN_UIDS, FIREBASE_SERVICE_ACCOUNT) are read from the project-root
REM .env and pushed with `wrangler secret put` before deploy, so production matches your
REM local values without a manual step. .env is git-ignored; values must not contain ! or %%.
REM
REM Users always get the newest build: Vite emits hashed, immutable assets and
REM firebase.json serves index.html with Cache-Control: no-cache, so every page load
REM picks up the new asset hashes. No cache purge is needed.

setlocal enabledelayedexpansion

set DEPLOY_APP=0
set DEPLOY_API=0
set DEPLOY_RULES=0
set BUILD_ONLY=0
set SHOW_MENU=0

set "FIREBASE_PROJECT=tripdesignai"
set "WORKER_NAME=wayfare-api"
set "HOSTING_URL=https://tripdesignai.web.app"

REM If no arguments, show menu
if "%~1"=="" set SHOW_MENU=1

:parse_args
if "%~1"=="" goto done_parsing
if "%~1"=="--all" (
    set DEPLOY_APP=1
    set DEPLOY_API=1
    set DEPLOY_RULES=1
)
if "%~1"=="--app" set DEPLOY_APP=1
if "%~1"=="--api" set DEPLOY_API=1
if "%~1"=="--rules" set DEPLOY_RULES=1
if "%~1"=="--build-only" set BUILD_ONLY=1
shift
goto parse_args
:done_parsing

REM A plain --build-only builds every deployable target without pushing.
if %BUILD_ONLY%==1 if %DEPLOY_APP%==0 if %DEPLOY_API%==0 if %DEPLOY_RULES%==0 (
    set DEPLOY_APP=1
    set DEPLOY_API=1
    set DEPLOY_RULES=1
)

REM Show interactive menu if no arguments
if %SHOW_MENU%==1 (
    echo.
    echo ========================================
    echo    Wayfare Deploy Menu
    echo ========================================
    echo.
    echo  1. Deploy ALL ^(Worker + Hosting + Rules^)
    echo  2. Deploy App only ^(Hosting^)
    echo  3. Deploy API only ^(Cloudflare Worker^)
    echo  4. Deploy Firestore Rules only
    echo  5. Deploy App + API
    echo  6. Exit
    echo.
    set /p choice="Select option (1-6): "

    if "!choice!"=="1" (
        set DEPLOY_APP=1
        set DEPLOY_API=1
        set DEPLOY_RULES=1
    )
    if "!choice!"=="2" set DEPLOY_APP=1
    if "!choice!"=="3" set DEPLOY_API=1
    if "!choice!"=="4" set DEPLOY_RULES=1
    if "!choice!"=="5" (
        set DEPLOY_APP=1
        set DEPLOY_API=1
    )
    if "!choice!"=="6" goto end
    if "!choice!"=="" goto end
)

echo.
echo ========================================
echo    Wayfare Deployment
echo ========================================
echo.
echo Selected targets:
if %DEPLOY_API%==1 echo   - Cloudflare Worker: %WORKER_NAME%
if %DEPLOY_APP%==1 echo   - Web App ^(Firebase Hosting^)
if %DEPLOY_RULES%==1 echo   - Firestore Rules
echo.

REM ---------- Preflight: refuse dirty trees and failing checks ----------
echo [PREFLIGHT] Checking git working tree...
set DIRTY=
for /f "delims=" %%L in ('git status --porcelain') do set DIRTY=1
if defined DIRTY (
    echo [ERROR] Working tree has uncommitted changes. Commit or stash before deploying.
    git status --short
    goto error
)
echo [PREFLIGHT] Installing dependencies ^(frozen lockfile^)...
call pnpm install --frozen-lockfile
if errorlevel 1 goto error
echo [PREFLIGHT] Typecheck...
call pnpm typecheck
if errorlevel 1 goto error
echo [PREFLIGHT] Lint...
call pnpm lint
if errorlevel 1 goto error
echo [PREFLIGHT] Tests...
call pnpm test
if errorlevel 1 goto error
echo [PREFLIGHT] Dependency audit ^(high or worse fails^)...
call pnpm audit --audit-level high
if errorlevel 1 (
    echo [ERROR] pnpm audit found high/critical vulnerabilities. Fix or override them before deploying.
    goto error
)
echo [OK] Preflight passed
echo.

set DEPLOY_TARGETS=

REM Build Web App
if %DEPLOY_APP%==1 (
    echo [BUILD] Web app...
    if not exist "%~dp0apps\web\.env.production" (
        echo [ERROR] apps\web\.env.production not found. Create it from apps\web\.env.production.example.
        goto error
    )
    call pnpm --filter @wayfare/web build
    if errorlevel 1 goto error
    echo [BUILD] Scanning bundle for secrets...
    call pnpm --filter @wayfare/tools exec vitest run test/bundleSecrets.test.ts
    if errorlevel 1 (
        echo [ERROR] Bundle secret scan failed - a server secret is in the client build.
        goto error
    )
    set DEPLOY_TARGETS=!DEPLOY_TARGETS!,hosting
    echo [OK] Web app built
    echo.
)

REM Typecheck Worker (wrangler bundles at deploy time)
if %DEPLOY_API%==1 (
    echo [BUILD] Worker typecheck...
    call pnpm --filter @wayfare/api build
    if errorlevel 1 goto error
    echo [OK] Worker ready
    echo.
)

REM Add rules target
if %DEPLOY_RULES%==1 (
    set DEPLOY_TARGETS=!DEPLOY_TARGETS!,firestore:rules
)

REM Exit if build-only mode
if %BUILD_ONLY%==1 (
    echo ========================================
    echo    Build Complete (deploy skipped^)
    echo ========================================
    goto end
)

REM Remove leading comma from targets
if not "!DEPLOY_TARGETS!"=="" (
    set DEPLOY_TARGETS=!DEPLOY_TARGETS:~1!
)

REM Sync ALL Worker secrets from .env -> Cloudflare before deploying the Worker
if %DEPLOY_API%==1 (
    echo [SECRETS] Syncing Worker secrets from .env to Cloudflare...
    if not exist "%~dp0.env" (
        echo [ERROR] .env not found in repo root. Create it from .env.example.
        goto error
    )
    for %%S in (GEMINI_API_KEY OPENROUTER_API_KEY TAVILY_API_KEY ADMIN_UIDS FIREBASE_SERVICE_ACCOUNT GITHUB_DISPATCH_TOKEN) do (
        set "SECRET_VAL="
        for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do (
            if "%%A"=="%%S" set "SECRET_VAL=%%B"
        )
        if not defined SECRET_VAL (
            echo   [WARN] %%S not found or empty in .env - skipping
        ) else (
            set "TMPFILE=%TEMP%\wayfare_secret_%%S.tmp"
            rem <nul set /p writes the value WITHOUT a trailing newline; echo would append CRLF into the secret.
            <nul set /p "=!SECRET_VAL!" > "!TMPFILE!"
            cd /d %~dp0apps\api
            call pnpm exec wrangler secret put %%S < "!TMPFILE!"
            if errorlevel 1 (
                del /q "!TMPFILE!" >nul 2>&1
                echo   [ERROR] Failed to set %%S
                cd /d %~dp0
                goto error
            ) else (
                echo   [OK] %%S synced
            )
            cd /d %~dp0
            del /q "!TMPFILE!" >nul 2>&1
        )
        set "SECRET_VAL="
    )
    echo.
)

REM Deploy Worker (Cloudflare, not Firebase)
if %DEPLOY_API%==1 (
    echo [DEPLOY] Cloudflare Worker ^(%WORKER_NAME%^)...
    cd /d %~dp0apps\api
    call pnpm exec wrangler deploy
    if errorlevel 1 (
        cd /d %~dp0
        goto error
    )
    cd /d %~dp0
    echo [OK] Worker deployed
    echo.
)

REM Execute Firebase deploy with specific targets
if not "!DEPLOY_TARGETS!"=="" (
    echo [DEPLOY] Deploying to Firebase...
    echo Running: firebase deploy --only !DEPLOY_TARGETS! --project %FIREBASE_PROJECT%
    echo.
    cd /d %~dp0infra\firebase
    call pnpm exec firebase deploy --only !DEPLOY_TARGETS! --project %FIREBASE_PROJECT%
    if errorlevel 1 (
        cd /d %~dp0
        goto error
    )
    cd /d %~dp0
) else (
    if %DEPLOY_API%==0 (
        echo [WARN] Nothing selected to deploy.
        goto end
    )
)

echo.
echo ========================================
echo    Deployment Complete!
echo ========================================
echo.
echo Deployed:
if %DEPLOY_API%==1 echo   [OK] Cloudflare Worker: %WORKER_NAME%
if %DEPLOY_APP%==1 echo   [OK] Web App ^(Hosting^): %HOSTING_URL%
if %DEPLOY_RULES%==1 echo   [OK] Firestore Rules
echo.
echo Live at: %HOSTING_URL%

REM Tag the deploy: deploy-YYYYMMDD-HHMM (PowerShell formats the date locale-independently;
REM %date%/%time% vary by Windows locale and contain / : and spaces).
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%T"
git tag "deploy-!STAMP!"
if errorlevel 1 (
    echo [WARN] Could not create tag deploy-!STAMP! ^(already exists?^)
) else (
    git push --tags
    if errorlevel 1 (
        echo [WARN] Tag created locally but push --tags failed.
    ) else (
        echo [OK] Tagged deploy-!STAMP!
    )
)

goto end

:error
echo.
echo [ERROR] Deployment failed!
exit /b 1

:end
endlocal
