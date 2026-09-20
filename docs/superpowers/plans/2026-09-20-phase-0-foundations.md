# Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the zero-cost infrastructure so that a Google-signed-in user can call a protected `/ping` on the Cloudflare Worker, the owner's UID is locked as admin in both Firestore rules and the Worker, the LLM model registry + fallback router works against real free-tier keys, and CI tests and deploys everything on push.

**Architecture:** pnpm monorepo. `packages/domain` holds pure TypeScript shared by everything (locale registry, config schema, API contracts, model registry). `packages/providers` holds the LLM adapters (Gemini, OpenRouter) and the `ModelRouter` that walks a fallback chain with quota tracking. `apps/api` is a Hono app on Cloudflare Workers (free plan) that verifies Firebase ID tokens with `jose`, guards admin routes by a hardcoded UID secret, and talks to Firestore over REST with a service account. `apps/web` is a Vite + React 19 SPA (TanStack Router, Tailwind v4, shadcn/ui, react-i18next) on Firebase Hosting with Google sign-in. `infra/firebase` holds Firestore rules + emulator tests. GitHub Actions runs tests and deploys.

**Tech Stack:** Node 22 LTS, pnpm 10, TypeScript 5.x (strict), Biome (lint+format), Vitest 3, Hono 4, jose 6, `@cloudflare/vitest-pool-workers`, wrangler 4, Firebase JS SDK 12 (Auth only in the browser), `firebase-tools` CLI, `@firebase/rules-unit-testing`, Vite 7, React 19, TanStack Router + Query, Tailwind CSS 4, shadcn/ui, react-i18next, Zod 4, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-20-trip-planner-design.md` — this plan implements Phase 0 of §11 and the parts of §2, §3.4, §6, §7, §8 and §2.5 it depends on. Executors read both.

## Global Constraints

- **Zero cost, no card anywhere** (spec §0 #1): Firebase **Spark** plan only; Cloudflare **Workers Free** only; GitHub Actions free minutes; Gemini via a free **AI Studio** key; OpenRouter `:free` models only. Never enable billing, never add a payment method, never install the Stripe SDK.
- **TypeScript everywhere** (spec §0 #7). `strict: true`, no `any` except at untyped boundaries wrapped in Zod parsing.
- **Secrets exist only as Cloudflare Worker secrets** (spec §8): `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `ADMIN_UIDS`, `FIREBASE_SERVICE_ACCOUNT`. Never in the web bundle, Firestore, or the repo. Locally they live in `apps/api/.dev.vars` (dev) and the repo-root `.env` (source for `prod.bat` secret sync); both are git-ignored, only `*.example` files are committed. These five names are used **identically** in `Env`, `.dev.vars`, `.env`, `dev.bat`, `prod.bat`, `wrangler secret put` and the tests.
- **Web env var names:** `VITE_API_URL` (Worker base URL), `VITE_USE_EMULATORS` (`1` → connect the Firebase SDK to local emulators), plus the four `VITE_FIREBASE_*` config values (public, not secrets).
- **Security: every security rule in spec §8 that applies to this phase must have an automated test; Phase 0 is not done until the independent security review (Task 17) has no open high/medium findings.**
- **Admin identity = Firebase UID, hardcoded in deployed code** (spec §8): in `infra/firebase/firestore.rules` (`isAdmin()`) and in the Worker secret `ADMIN_UIDS`. No `admins` collection.
- **Token rules** (spec §8): verify RS256 signature via Google JWKS, `iss = https://securetoken.google.com/<projectId>`, `aud = <projectId>`, `exp` future, `sub` non-empty, `email_verified === true`. Admin **state-changing** requests additionally require `auth_time` within the last **15 minutes**.
- **Firestore rules deny by default** (spec §6/§8). Clients may read their own `users/{uid}`; everything else in Phase 0 is Worker-only via service account.
- **Firestore region:** Europe multi-region **`eur3`**, chosen at database creation (cannot change later).
- **Domain:** `<project>.web.app` (Firebase Hosting default). `ALLOWED_ORIGIN` on the Worker equals exactly that origin; CORS denies everything else.
- **Free-tier ceilings to respect in code** (spec §2.3): Firestore 50k reads / 20k writes per day; Workers 100k req/day and 10 ms CPU per request; **KV 1,000 writes/day** → KV is used only for the cached service-account access token and "model exhausted" flags; all per-call counters go to Firestore.
- **Locale registry** (spec §2.5): `en` (ltr) and `he` (rtl) enabled; `dir` derived from the registry row, never from the language code.
- **Package names:** `@wayfare/domain`, `@wayfare/providers`, `@wayfare/api`, `@wayfare/web`, `@wayfare/firebase-rules`. Product name is a placeholder; do not hardcode it in user-facing strings outside the i18n files.
- **Commit style:** Conventional Commits (`feat:`, `test:`, `chore:`, `ci:`, `docs:`). Commit after every task's last step.
- **File edits on Windows:** never edit source files through PowerShell string pipelines (they re-encode UTF-8 and corrupt Hebrew/Greek characters); use the editor or Node scripts.

---

## File Structure (end of Phase 0)

```
TripDesignApp/
├─ package.json                  # workspace scripts: lint, typecheck, test, build, secret-scan, scan:bundle; simple-git-hooks pre-commit
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ biome.json
├─ .nvmrc                        # 22
├─ .gitignore                    # .env, .dev.vars, *service-account*.json, *.pem, *.p12, *.key (tested)
├─ .env.example                  # GEMINI_API_KEY, OPENROUTER_API_KEY, TAVILY_API_KEY, ADMIN_UIDS, FIREBASE_SERVICE_ACCOUNT
├─ dev.bat                       # emulators + Worker + app with hot reload (Task 14)
├─ prod.bat                      # guarded deploy: clean tree, typecheck/lint/test/audit, build, secret sync, deploy, tag (Task 14)
├─ .github/workflows/ci.yml      # lint, typecheck, unit tests, rules tests, audit, web build, bundle + repo secret scans
├─ .github/workflows/deploy.yml  # on push master: Worker, Hosting, Firestore rules
├─ tools/                        # @wayfare/tools — repo-level checks
│  ├─ scripts/secret-scan.mjs    # pre-commit / CI secret scanner (gitleaks if present, regex fallback)
│  └─ test/{gitignore,secretScan,bundleSecrets}.test.ts
├─ packages/domain/              # @wayfare/domain — pure TS, zero runtime deps except zod
│  ├─ src/i18n/locales.ts        # LOCALES registry, getLocale, DEFAULT_LOCALE
│  ├─ src/config/schema.ts       # AppConfigSchema (magic numbers, tier limits), DEFAULT_CONFIG
│  ├─ src/api/contracts.ts       # Zod schemas for API responses (Ping, AdminPing, ApiError, LlmPing)
│  ├─ src/models/registry.ts     # ModelRegistrySchema, TaskType, chainFor()
│  ├─ src/models/registry.json   # the Sep-2026 model list from spec §3.4
│  └─ src/index.ts
├─ packages/providers/           # @wayfare/providers — LLM adapters + router
│  ├─ src/llm/types.ts           # LlmProvider, LlmRequest, LlmResult, LlmError
│  ├─ src/llm/classify.ts        # classifyHttpError
│  ├─ src/llm/gemini.ts          # GeminiProvider
│  ├─ src/llm/openrouter.ts      # OpenRouterProvider
│  ├─ src/llm/reset.ts           # providerDayKey(), nextResetIso()
│  ├─ src/llm/memoryQuotaStore.ts# QuotaStore interface + InMemoryQuotaStore
│  ├─ src/llm/router.ts          # ModelRouter
│  └─ src/index.ts
├─ apps/api/                     # @wayfare/api — Cloudflare Worker (Hono)
│  ├─ wrangler.toml
│  ├─ src/env.ts                 # Env bindings type
│  ├─ src/app.ts                 # createApp({ jwks?, fetchImpl?, now? }) — routes + middleware
│  ├─ src/index.ts               # export default { fetch }
│  ├─ src/http/errors.ts         # apiError()
│  ├─ src/middleware/cors.ts
│  ├─ src/middleware/securityHeaders.ts
│  ├─ src/middleware/rateLimit.ts # in-memory token bucket per IP/uid (Phase 6 baseline)
│  ├─ src/auth/verifyIdToken.ts  # jose verification → AuthUser; emulator mode via FIREBASE_AUTH_EMULATOR_HOST
│  ├─ src/auth/middleware.ts     # firebaseAuth
│  ├─ src/auth/admin.ts          # requireAdmin, parseAdminUids
│  ├─ src/firestore/serviceAccount.ts # getAccessToken (KV-cached), parseServiceAccount
│  ├─ src/firestore/values.ts    # Firestore value codec
│  ├─ src/firestore/client.ts    # FirestoreClient (REST)
│  ├─ src/firestore/quotaStore.ts# FirestoreQuotaStore implements QuotaStore
│  ├─ src/llm/routerFactory.ts   # createRouter(env, deps, db)
│  ├─ src/routes/ping.ts         # GET /ping (ensures users/{uid}, touches metrics)
│  ├─ src/routes/admin.ts        # GET /admin/ping, POST /admin/echo, POST /admin/llm/ping
│  └─ test/…                     # vitest-pool-workers tests + helpers
├─ apps/web/                     # @wayfare/web — Vite React SPA
│  ├─ index.html, vite.config.ts, components.json (shadcn)
│  ├─ src/main.tsx, src/index.css, src/routeTree.gen.ts (generated, committed)
│  ├─ src/routes/__root.tsx      # shell: header, language select, sign-in
│  ├─ src/routes/index.tsx       # /ping demo
│  ├─ src/routes/admin.tsx       # admin ping + LLM chain test
│  ├─ src/components/LanguageSelect.tsx
│  ├─ src/lib/firebase.ts        # app, auth, signInWithGoogle()
│  ├─ src/lib/emulators.ts       # connectAuthEmulator when VITE_USE_EMULATORS=1
│  ├─ src/lib/useAuth.ts
│  ├─ src/lib/api.ts             # apiFetch<T>(path, schema, init)
│  ├─ src/i18n/index.ts, en.json, he.json
│  └─ src/test/…                 # Testing Library tests
└─ infra/firebase/               # @wayfare/firebase-rules
   ├─ firebase.json              # hosting (public: ../../apps/web/dist, security headers, index.html no-cache), firestore, emulators (auth 9099, firestore 8080, UI 4000)
   ├─ .firebaserc
   ├─ firestore.rules
   ├─ firestore.indexes.json
   └─ test/rules.test.ts         # @firebase/rules-unit-testing against the emulator
```

---

### Task 0: Accounts, keys and local prerequisites (manual checklist, no code)

**Files:** none committed. Produces values used by later tasks.

**Interfaces:**
- Produces: `FIREBASE_PROJECT_ID`, Firebase web config (apiKey, authDomain, projectId, appId), `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, service-account JSON, Cloudflare account id, GitHub secrets.

- [ ] **Step 1: Verify local tools**

```powershell
node -v       # expect v22.x
pnpm -v       # expect 10.x  (if missing: corepack enable; corepack prepare pnpm@latest --activate)
java -version # expect 17 or 21 (Firestore emulator; if missing: winget install EclipseAdoptium.Temurin.21.JDK)
git --version
```

- [ ] **Step 2: Create the Firebase project (Spark)**

1. https://console.firebase.google.com → **Add project** → name `tripdesignapp` (the generated id is `FIREBASE_PROJECT_ID`, e.g. `tripdesignapp-1a2b3`). Disable Google Analytics. **Do not upgrade to Blaze.**
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**; set the support email. **Settings → User actions**: enable *Email enumeration protection*. **Settings → Authorized domains**: keep `localhost` and `<project>.web.app` / `<project>.firebaseapp.com`.
3. **Build → Firestore Database → Create database → Location `eur3 (Europe)` → production mode.** (Region is permanent.)
4. **Project settings → General → Your apps → Web (</>) → register `web`** → copy the `firebaseConfig` values (apiKey, authDomain, projectId, appId).
5. **Build → Hosting → Get started** (enable only; the deploy happens in Task 13). Note `<project>.web.app`.

- [ ] **Step 3: Create the service account used by the Worker and CI**

1. https://console.cloud.google.com → select the Firebase project → **IAM & Admin → Service Accounts → Create**: `wayfare-worker`.
2. Roles: `Cloud Datastore User` (Worker), `Firebase Hosting Admin` and `Firebase Rules Admin` (CI deploys). Nothing else.
3. **Keys → Add key → JSON** → download. Its single-line JSON is the Worker secret `FIREBASE_SERVICE_ACCOUNT` (Task 13 / `prod.bat`) and the GitHub secret `FIREBASE_SERVICE_ACCOUNT` (Task 15). Never commit it.

- [ ] **Step 4: Cloudflare**

1. https://dash.cloudflare.com → sign up (free, no card). Note the **Account ID** (Workers & Pages → Overview).
2. Locally: `pnpm dlx wrangler@4 login` (browser), then `pnpm dlx wrangler@4 whoami`.
3. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template → scope to this account → copy → GitHub secret `CLOUDFLARE_API_TOKEN`.

- [ ] **Step 5: LLM keys**

1. https://aistudio.google.com/apikey → **Create API key** inside the Firebase project → `GEMINI_API_KEY`. Do not link billing.
2. https://openrouter.ai → **Keys → Create** → `OPENROUTER_API_KEY`. Do not buy credits.
3. https://app.tavily.com → sign up (free tier, no card) → **API key** → `TAVILY_API_KEY`. (Not called in Phase 0; the secret slot exists so the Search chain in Phase 1 needs no infra change.)
4. Create the repo-root `.env` (git-ignored; read only by `prod.bat`) from `.env.example` with the five secret names above, and `apps/api/.dev.vars` from its example.

- [ ] **Step 6: GitHub repository secrets and variables** (Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Step 4 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Step 4 |
| Secret | `FIREBASE_SERVICE_ACCOUNT` | full JSON from Step 3 |
| Secret | `FIREBASE_PROJECT_ID` | e.g. `tripdesignapp-1a2b3` |
| Variable | `VITE_FIREBASE_API_KEY` | Step 2.4 (public web config) |
| Variable | `VITE_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
| Variable | `VITE_FIREBASE_APP_ID` | Step 2.4 |
| Variable | `VITE_API_URL` | set after Task 13 Step 1 (`https://wayfare-api.<subdomain>.workers.dev`) |

---

### Task 1: Monorepo scaffold with a passing smoke test

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.nvmrc`, `.gitignore`, `.editorconfig`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/index.ts`, `packages/domain/src/version.ts`, `packages/domain/src/version.test.ts`

**Interfaces:**
- Produces: workspace scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; `@wayfare/domain` exporting `DOMAIN_VERSION`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "tripdesignapp",
  "private": true,
  "packageManager": "pnpm@10.15.0",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "pnpm -r --parallel typecheck",
    "test": "pnpm -r --parallel --filter '!@wayfare/firebase-rules' test",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.2.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "infra/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.2.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/dist/**", "!**/routeTree.gen.ts", "!**/.wrangler/**", "!docs/**", "!**/components/ui/**"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" } } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

`.nvmrc`: `22`

`.gitignore`:
```
node_modules/
dist/
.wrangler/
.dev.vars
.dev.vars.*
!.dev.vars.example
.env
.env.*
!.env.example
!.env.production.example
*.local
firebase-debug.log
firestore-debug.log
ui-debug.log
.firebase/
coverage/
*.tsbuildinfo
.cursor/
*service-account*.json
*.pem
*.p12
*.key
```

`.env.example` (repo root; the real `.env` is the source `prod.bat` syncs to Worker secrets):
```
GEMINI_API_KEY=
OPENROUTER_API_KEY=
TAVILY_API_KEY=
ADMIN_UIDS=
FIREBASE_SERVICE_ACCOUNT=
```

`.editorconfig`:
```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

- [ ] **Step 2: `@wayfare/domain` skeleton**

`packages/domain/package.json`:
```json
{
  "name": "@wayfare/domain",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "build": "tsc --noEmit" },
  "dependencies": { "zod": "^4.1.0" },
  "devDependencies": { "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```

`packages/domain/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["vitest/globals"] }, "include": ["src"] }
```

`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: true, include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Write the failing smoke test**

`packages/domain/src/version.test.ts`:
```ts
import { DOMAIN_VERSION } from "./version";

test("domain package exposes a semver version", () => {
  expect(DOMAIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm install && pnpm --filter @wayfare/domain test`
Expected: FAIL — `Cannot find module './version'`.

- [ ] **Step 5: Minimal implementation**

`packages/domain/src/version.ts`:
```ts
export const DOMAIN_VERSION = "0.0.1";
```
`packages/domain/src/index.ts`:
```ts
export { DOMAIN_VERSION } from "./version";
```

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/domain test && pnpm lint && pnpm typecheck`
Expected: 1 test PASS; Biome clean; tsc clean.

- [ ] **Step 7: Failing test — `.gitignore` covers every secret-bearing file pattern** (security)

Create `tools/` as a tiny workspace package for repo-level checks. `tools/package.json`:
```json
{
  "name": "@wayfare/tools",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "build": "echo skip", "secret-scan": "node scripts/secret-scan.mjs" },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```
`tools/tsconfig.json`: `{ "extends": "../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["vitest/globals", "node"], "allowJs": true }, "include": ["test", "scripts"] }` — and add `"tools"` to `pnpm-workspace.yaml` packages.

`tools/test/gitignore.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
/** Each path must be ignored by git; if any is tracked-able the test fails. */
const MUST_BE_IGNORED = [
  ".env",
  ".env.production",
  "apps/api/.dev.vars",
  "apps/web/.env",
  "apps/web/.env.production",
  "wayfare-service-account.json",
  "infra/service-account-prod.json",
  "keys/private.pem",
  "cert.p12",
  "id_rsa.key",
];
const MUST_NOT_BE_IGNORED = [".env.example", "apps/api/.dev.vars.example", "apps/web/.env.production.example"];

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test.each(MUST_BE_IGNORED)("%s is git-ignored", (p) => {
  expect(isIgnored(p)).toBe(true);
});

test.each(MUST_NOT_BE_IGNORED)("%s is NOT git-ignored (examples must be committed)", (p) => {
  expect(isIgnored(p)).toBe(false);
});
```
Run: `pnpm install && pnpm --filter @wayfare/tools test` — Expected: PASS for all paths (if any `MUST_BE_IGNORED` fails, fix `.gitignore` before continuing).

- [ ] **Step 8: Pre-commit secret scan (gitleaks if installed, regex fallback) wired with simple-git-hooks**

`tools/scripts/secret-scan.mjs`:
```js
// Scans staged files (or paths given as args) for secret-looking strings. Exit 1 on any hit.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/sk-or-v1-[0-9a-f]{64}/, "OpenRouter key"],
  [/tvly-[0-9A-Za-z_-]{20,}/, "Tavily key"],
  [/"private_key"\s*:\s*"-----BEGIN/, "Service-account private key"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key block"],
  [/ghp_[0-9A-Za-z]{36}/, "GitHub token"],
];
const ALLOW = [/\.example$/, /secret-scan\.mjs$/, /\/test\/helpers\/testPem\.ts$/, /pnpm-lock\.yaml$/];

const gitleaks = spawnSync("gitleaks", ["version"], { stdio: "ignore" });
if (gitleaks.status === 0) {
  const r = spawnSync("gitleaks", ["protect", "--staged", "--redact", "--no-banner"], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { encoding: "utf8" }).split("\n").filter(Boolean);

let hits = 0;
for (const f of files) {
  if (ALLOW.some((a) => a.test(f))) continue;
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) { console.error(`[secret-scan] ${label} in ${f}`); hits += 1; }
  }
}
if (hits) { console.error(`[secret-scan] ${hits} potential secret(s) found. Commit aborted.`); process.exit(1); }
console.log("[secret-scan] clean");
```

`tools/test/secretScan.test.ts`:
```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../scripts/secret-scan.mjs");

function scan(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  const file = join(dir, "leak.ts");
  writeFileSync(file, content);
  return spawnSync("node", [SCRIPT, file], { encoding: "utf8" });
}

test("flags a Google API key and a service-account private key", () => {
  expect(scan(`const k = "AIza${"A".repeat(35)}";`).status).toBe(1);
  expect(scan(`{"private_key": "-----BEGIN PRIVATE KEY-----\\nabc"}`).status).toBe(1);
});

test("passes clean code", () => {
  expect(scan(`export const x = 1;`).status).toBe(0);
});
```

Root `package.json` additions:
```json
"scripts": { "...": "...", "secret-scan": "pnpm --filter @wayfare/tools secret-scan", "prepare": "simple-git-hooks" },
"simple-git-hooks": { "pre-commit": "pnpm secret-scan" },
"devDependencies": { "...": "...", "simple-git-hooks": "^2.11.0" }
```
Run: `pnpm install && pnpm --filter @wayfare/tools test && git config core.hooksPath` — Expected: both tests PASS; `simple-git-hooks` installed the pre-commit hook (`.git/hooks/pre-commit` exists). Smoke: stage a file containing `AIza` + 35 chars → `git commit` is refused; unstage it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: pnpm monorepo scaffold with biome, vitest, @wayfare/domain, gitignore tests and pre-commit secret scan"
```

---

### Task 2: Locale registry, config schema and API contracts (`@wayfare/domain`)

**Files:**
- Create: `packages/domain/src/i18n/locales.ts`, `packages/domain/src/i18n/locales.test.ts`
- Create: `packages/domain/src/config/schema.ts`, `packages/domain/src/config/schema.test.ts`
- Create: `packages/domain/src/api/contracts.ts`, `packages/domain/src/api/contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `interface Locale { code: string; native: string; dir: "ltr" | "rtl"; enabled: boolean; intl: string }`, `LOCALES: readonly Locale[]`, `DEFAULT_LOCALE: Locale`, `getLocale(code: string | null | undefined): Locale` (falls back to default), `enabledLocales(): Locale[]`.
  - `AppConfigSchema` (Zod), `type AppConfig`, `DEFAULT_CONFIG: AppConfig` with `pace`, `tiers`, `engine`, `admin.freshAuthMaxAgeSec`.
  - `ApiErrorCode` (enum + type), `ApiErrorSchema`, `PingResponseSchema`, `AdminPingResponseSchema`, `LlmPingResponseSchema` and their inferred types `ApiError`, `PingResponse`, `AdminPingResponse`, `LlmPingResponse`.

- [ ] **Step 1: Failing tests for the locale registry**

`packages/domain/src/i18n/locales.test.ts`:
```ts
import { DEFAULT_LOCALE, LOCALES, enabledLocales, getLocale } from "./locales";

test("en and he are enabled; he is rtl", () => {
  const codes = enabledLocales().map((l) => l.code);
  expect(codes).toEqual(expect.arrayContaining(["en", "he"]));
  expect(getLocale("he").dir).toBe("rtl");
  expect(getLocale("en").dir).toBe("ltr");
});

test("unknown code falls back to the default locale", () => {
  expect(getLocale("xx")).toEqual(DEFAULT_LOCALE);
  expect(getLocale(null)).toEqual(DEFAULT_LOCALE);
});

test("codes are unique", () => {
  const codes = LOCALES.map((l) => l.code);
  expect(new Set(codes).size).toBe(codes.length);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wayfare/domain test`
Expected: FAIL — module `./locales` not found.

- [ ] **Step 3: Implement the registry**

`packages/domain/src/i18n/locales.ts`:
```ts
export type TextDirection = "ltr" | "rtl";

export interface Locale {
  /** BCP-47 language code used in storage and i18next. */
  readonly code: string;
  /** Name in its own language, shown in the language dropdown. */
  readonly native: string;
  readonly dir: TextDirection;
  /** Whether users can pick it today. Disabled rows render as "soon". */
  readonly enabled: boolean;
  /** Locale passed to Intl.DateTimeFormat / NumberFormat. */
  readonly intl: string;
}

/**
 * Single source of truth for languages (spec §2.5).
 * Adding a language = one row here + one strings file in apps/web/src/i18n.
 */
export const LOCALES: readonly Locale[] = [
  { code: "en", native: "English", dir: "ltr", enabled: true, intl: "en-GB" },
  { code: "he", native: "עברית", dir: "rtl", enabled: true, intl: "he-IL" },
];

export const DEFAULT_LOCALE: Locale = LOCALES[0] as Locale;

export function getLocale(code: string | null | undefined): Locale {
  return LOCALES.find((l) => l.code === code) ?? DEFAULT_LOCALE;
}

export function enabledLocales(): Locale[] {
  return LOCALES.filter((l) => l.enabled);
}
```

- [ ] **Step 4: Failing tests for the config schema**

`packages/domain/src/config/schema.test.ts`:
```ts
import { AppConfigSchema, DEFAULT_CONFIG } from "./schema";

test("default config validates", () => {
  expect(AppConfigSchema.parse(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
});

test("free tier has one lifetime generation and 2 refine iterations; plus has 3", () => {
  expect(DEFAULT_CONFIG.tiers.free.lifetimeGenerations).toBe(1);
  expect(DEFAULT_CONFIG.tiers.free.refineIterations).toBe(2);
  expect(DEFAULT_CONFIG.tiers.plus.refineIterations).toBe(3);
});

test("negative caps are rejected", () => {
  const bad = { ...DEFAULT_CONFIG, pace: { ...DEFAULT_CONFIG.pace, chill: { ...DEFAULT_CONFIG.pace.chill, activeHours: -1 } } };
  expect(() => AppConfigSchema.parse(bad)).toThrow();
});

test("admin fresh-auth window is 15 minutes", () => {
  expect(DEFAULT_CONFIG.admin.freshAuthMaxAgeSec).toBe(15 * 60);
});
```

- [ ] **Step 5: Implement the config schema**

`packages/domain/src/config/schema.ts`:
```ts
import { z } from "zod";

const PaceCapsSchema = z.object({
  activeHours: z.number().positive(),
  areasPerDay: z.number().int().positive(),
  walkingKm: z.number().positive(),
  restBlockMin: z.number().int().min(0),
});

const TierLimitsSchema = z.object({
  /** null = unlimited lifetime generations. */
  lifetimeGenerations: z.number().int().min(0).nullable(),
  newPlansPerMonth: z.number().int().min(0).nullable(),
  regenerationsPerMonth: z.number().int().min(0).nullable(),
  refineIterations: z.number().int().min(1).max(5),
  maxNights: z.number().int().positive(),
  vacationTypes: z.number().int().positive().nullable(),
  interestTags: z.number().int().positive().nullable(),
  mustVisits: z.number().int().positive().nullable(),
  briefChars: z.number().int().positive(),
  notes: z.number().int().min(0),
  noteChars: z.number().int().positive(),
});

export const AppConfigSchema = z.object({
  version: z.number().int().positive(),
  pace: z.object({ chill: PaceCapsSchema, balanced: PaceCapsSchema, packed: PaceCapsSchema }),
  tiers: z.object({ free: TierLimitsSchema, plus: TierLimitsSchema }),
  engine: z.object({
    shortlistSize: z.number().int().positive(),
    fastPackTargetPlaces: z.number().int().positive(),
    dayTripRadiusMin: z.number().int().positive(),
    scoutingUsesBestChain: z.boolean(),
  }),
  admin: z.object({ freshAuthMaxAgeSec: z.number().int().positive() }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Spec §3.5, §1.4, §7 defaults. Admin-tunable at runtime (config/current) in later phases. */
export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  pace: {
    chill: { activeHours: 5, areasPerDay: 2, walkingKm: 5, restBlockMin: 90 },
    balanced: { activeHours: 7, areasPerDay: 4, walkingKm: 8, restBlockMin: 60 },
    packed: { activeHours: 9.5, areasPerDay: 6, walkingKm: 12, restBlockMin: 0 },
  },
  tiers: {
    free: {
      lifetimeGenerations: 1,
      newPlansPerMonth: 0,
      regenerationsPerMonth: 0,
      refineIterations: 2,
      maxNights: 7,
      vacationTypes: 2,
      interestTags: 3,
      mustVisits: 3,
      briefChars: 300,
      notes: 2,
      noteChars: 240,
    },
    plus: {
      lifetimeGenerations: null,
      newPlansPerMonth: 3,
      regenerationsPerMonth: 10,
      refineIterations: 3,
      maxNights: 21,
      vacationTypes: null,
      interestTags: null,
      mustVisits: null,
      briefChars: 1500,
      notes: 10,
      noteChars: 240,
    },
  },
  engine: { shortlistSize: 180, fastPackTargetPlaces: 250, dayTripRadiusMin: 90, scoutingUsesBestChain: false },
  admin: { freshAuthMaxAgeSec: 15 * 60 },
};
```

- [ ] **Step 6: Failing tests for API contracts**

`packages/domain/src/api/contracts.test.ts`:
```ts
import { ApiErrorSchema, PingResponseSchema } from "./contracts";

test("ping response shape", () => {
  const ok = PingResponseSchema.parse({ ok: true, uid: "abc", serverTime: "2026-09-20T12:00:00.000Z", firstSeen: false });
  expect(ok.uid).toBe("abc");
  expect(() => PingResponseSchema.parse({ ok: true })).toThrow();
});

test("api error shape", () => {
  expect(ApiErrorSchema.parse({ error: "unauthorized", message: "Missing token" }).error).toBe("unauthorized");
  expect(() => ApiErrorSchema.parse({ error: "weird", message: "x" })).toThrow();
});
```

- [ ] **Step 7: Implement contracts**

`packages/domain/src/api/contracts.ts`:
```ts
import { z } from "zod";

export const ApiErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "reauth_required",
  "bad_request",
  "not_found",
  "rate_limited",
  "upstream_exhausted",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorSchema = z.object({ error: ApiErrorCode, message: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PingResponseSchema = z.object({
  ok: z.literal(true),
  uid: z.string().min(1),
  serverTime: z.string().datetime(),
  /** true when this request created the users/{uid} document. */
  firstSeen: z.boolean(),
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

export const AdminPingResponseSchema = z.object({
  ok: z.literal(true),
  uid: z.string().min(1),
  authAgeSec: z.number().int().min(0),
});
export type AdminPingResponse = z.infer<typeof AdminPingResponseSchema>;

export const LlmPingResponseSchema = z.object({
  ok: z.literal(true),
  modelUsed: z.string(),
  provider: z.string(),
  attempts: z.array(z.object({ modelId: z.string(), outcome: z.string() })),
  text: z.string(),
});
export type LlmPingResponse = z.infer<typeof LlmPingResponseSchema>;
```

- [ ] **Step 8: Export from the index**

`packages/domain/src/index.ts`:
```ts
export { DOMAIN_VERSION } from "./version";
export * from "./i18n/locales";
export * from "./config/schema";
export * from "./api/contracts";
```

- [ ] **Step 9: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/domain test && pnpm lint && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): locale registry, app config schema with defaults, API contracts"
```

---

### Task 3: Model registry and fallback chains (`@wayfare/domain`)

**Files:**
- Create: `packages/domain/src/models/registry.ts`, `packages/domain/src/models/registry.json`, `packages/domain/src/models/registry.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `type ProviderId = "google" | "openrouter"`, `type TaskType = "best" | "extract" | "search"`.
  - `ModelEntrySchema`, `interface ModelEntry { id: string; provider: ProviderId; modelId: string; enabled: boolean; capabilities: { jsonSchema: boolean; contextTokens: number }; rank: { best?: number; extract?: number; search?: number }; observedRpd?: number }`.
  - `ModelRegistrySchema`, `type ModelRegistry = { version: number; models: ModelEntry[] }`.
  - `loadRegistry(json: unknown): ModelRegistry` — throws on invalid input or duplicate ids.
  - `chainFor(registry: ModelRegistry, task: TaskType): ModelEntry[]` — enabled entries with a rank for `task`, ascending.
  - `DEFAULT_REGISTRY: ModelRegistry`.

- [ ] **Step 1: Failing tests**

`packages/domain/src/models/registry.test.ts`:
```ts
import { DEFAULT_REGISTRY, chainFor, loadRegistry } from "./registry";

const entry = (id: string, provider: "google" | "openrouter", rank: Record<string, number>, enabled = true) => ({
  id,
  provider,
  modelId: id,
  enabled,
  capabilities: { jsonSchema: true, contextTokens: 1000 },
  rank,
});

test("default registry: best chain starts with gemini-3.8-flash and ends with openrouter/free", () => {
  const chain = chainFor(DEFAULT_REGISTRY, "best");
  expect(chain.length).toBeGreaterThan(5);
  expect(chain[0]?.modelId).toBe("gemini-3.8-flash");
  expect(chain.at(-1)?.modelId).toBe("openrouter/free");
});

test("extract chain starts with gemini-3.5-flash-lite; search chain starts with gemini-2.5-flash-lite", () => {
  expect(chainFor(DEFAULT_REGISTRY, "extract")[0]?.modelId).toBe("gemini-3.5-flash-lite");
  expect(chainFor(DEFAULT_REGISTRY, "search")[0]?.modelId).toBe("gemini-2.5-flash-lite");
});

test("disabled models are skipped", () => {
  const reg = loadRegistry({ version: 1, models: [entry("a", "google", { best: 1 }, false), entry("b", "google", { best: 2 })] });
  expect(chainFor(reg, "best").map((m) => m.id)).toEqual(["b"]);
});

test("duplicate ids are rejected", () => {
  expect(() => loadRegistry({ version: 1, models: [entry("a", "google", { best: 1 }), entry("a", "google", { best: 2 })] })).toThrow(/duplicate/i);
});

test("a chain is sorted by rank even if the file is not", () => {
  const reg = loadRegistry({ version: 1, models: [entry("z", "openrouter", { best: 9 }), entry("y", "google", { best: 1 })] });
  expect(chainFor(reg, "best").map((m) => m.id)).toEqual(["y", "z"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wayfare/domain test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema and helpers**

`packages/domain/src/models/registry.ts`:
```ts
import { z } from "zod";
import registryJson from "./registry.json";

export const ProviderIdSchema = z.enum(["google", "openrouter"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const TaskTypeSchema = z.enum(["best", "extract", "search"]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const ModelEntrySchema = z.object({
  /** Stable internal id, e.g. "google:gemini-3.8-flash". */
  id: z.string().min(1),
  provider: ProviderIdSchema,
  /** Provider-specific model id sent on the wire. */
  modelId: z.string().min(1),
  enabled: z.boolean(),
  capabilities: z.object({ jsonSchema: z.boolean(), contextTokens: z.number().int().positive() }),
  /** Lower rank = tried earlier. Absent = not part of that chain. */
  rank: z.object({
    best: z.number().int().positive().optional(),
    extract: z.number().int().positive().optional(),
    search: z.number().int().positive().optional(),
  }),
  /** Learned daily request cap (spec §3.4). Unknown until the first daily 429. */
  observedRpd: z.number().int().positive().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelRegistrySchema = z.object({
  version: z.number().int().positive(),
  models: z.array(ModelEntrySchema).min(1),
});
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;

export function loadRegistry(json: unknown): ModelRegistry {
  const reg = ModelRegistrySchema.parse(json);
  const seen = new Set<string>();
  for (const m of reg.models) {
    if (seen.has(m.id)) throw new Error(`Model registry: duplicate id "${m.id}"`);
    seen.add(m.id);
  }
  return reg;
}

export function chainFor(registry: ModelRegistry, task: TaskType): ModelEntry[] {
  return registry.models
    .filter((m) => m.enabled && m.rank[task] !== undefined)
    .sort((a, b) => (a.rank[task] as number) - (b.rank[task] as number));
}

export const DEFAULT_REGISTRY: ModelRegistry = loadRegistry(registryJson);
```

`packages/domain/src/models/registry.json` (spec §3.4 snapshot, Sep 2026; verify ids against the provider catalogues before the first live call):
```json
{
  "version": 1,
  "models": [
    { "id": "google:gemini-3.8-flash", "provider": "google", "modelId": "gemini-3.8-flash", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "best": 1 } },
    { "id": "google:gemini-3.7-flash", "provider": "google", "modelId": "gemini-3.7-flash", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "best": 2 } },
    { "id": "google:gemini-3.6-flash", "provider": "google", "modelId": "gemini-3.6-flash", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "best": 3 } },
    { "id": "google:gemini-3.5-flash", "provider": "google", "modelId": "gemini-3.5-flash", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "best": 4 } },
    { "id": "google:gemini-2.5-pro", "provider": "google", "modelId": "gemini-2.5-pro", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "best": 5 } },
    { "id": "google:gemini-2.5-flash", "provider": "google", "modelId": "gemini-2.5-flash", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "best": 6, "search": 2 } },
    { "id": "google:gemma-4-31b-it", "provider": "google", "modelId": "gemma-4-31b-it", "enabled": true, "capabilities": { "jsonSchema": false, "contextTokens": 262144 }, "rank": { "best": 7 } },
    { "id": "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free", "provider": "openrouter", "modelId": "nvidia/nemotron-3-ultra-550b-a55b:free", "enabled": true, "capabilities": { "jsonSchema": false, "contextTokens": 1000000 }, "rank": { "best": 8 } },
    { "id": "openrouter:nex-agi/nex-n2.5-pro:free", "provider": "openrouter", "modelId": "nex-agi/nex-n2.5-pro:free", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 262144 }, "rank": { "best": 9 } },
    { "id": "openrouter:qwen/qwen3.8-27b:free", "provider": "openrouter", "modelId": "qwen/qwen3.8-27b:free", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 262144 }, "rank": { "best": 10 } },
    { "id": "openrouter:google/gemma-4-31b-it:free", "provider": "openrouter", "modelId": "google/gemma-4-31b-it:free", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 262144 }, "rank": { "best": 11 } },
    { "id": "google:gemini-3.5-flash-lite", "provider": "google", "modelId": "gemini-3.5-flash-lite", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "extract": 1 } },
    { "id": "google:gemini-3.1-flash-lite", "provider": "google", "modelId": "gemini-3.1-flash-lite", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "extract": 2 } },
    { "id": "google:gemini-2.5-flash-lite", "provider": "google", "modelId": "gemini-2.5-flash-lite", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "extract": 3, "search": 1 } },
    { "id": "google:gemini-2.0-flash", "provider": "google", "modelId": "gemini-2.0-flash", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 1048576 }, "rank": { "extract": 4 } },
    { "id": "google:gemma-4-26b-a4b-it", "provider": "google", "modelId": "gemma-4-26b-a4b-it", "enabled": true, "capabilities": { "jsonSchema": false, "contextTokens": 262144 }, "rank": { "extract": 5 } },
    { "id": "openrouter:nvidia/nemotron-3-super-120b-a12b:free", "provider": "openrouter", "modelId": "nvidia/nemotron-3-super-120b-a12b:free", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 262144 }, "rank": { "extract": 6 } },
    { "id": "openrouter:inclusionai/ling-3.0-flash-fin:free", "provider": "openrouter", "modelId": "inclusionai/ling-3.0-flash-fin:free", "enabled": true, "capabilities": { "jsonSchema": false, "contextTokens": 262144 }, "rank": { "extract": 7 } },
    { "id": "openrouter:nex-agi/nex-n2.5-mini:free", "provider": "openrouter", "modelId": "nex-agi/nex-n2.5-mini:free", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 262144 }, "rank": { "extract": 8 } },
    { "id": "openrouter:openrouter/free", "provider": "openrouter", "modelId": "openrouter/free", "enabled": true, "capabilities": { "jsonSchema": true, "contextTokens": 200000 }, "rank": { "best": 12, "extract": 9 } }
  ]
}
```

Add to `packages/domain/src/index.ts`: `export * from "./models/registry";`

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/domain test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): model registry schema, Sep-2026 free model list, chainFor()"
```

---

### Task 4: LLM provider adapters — Gemini and OpenRouter (`@wayfare/providers`)

**Files:**
- Create: `packages/providers/package.json`, `packages/providers/tsconfig.json`, `packages/providers/vitest.config.ts`
- Create: `packages/providers/src/llm/types.ts`, `packages/providers/src/llm/classify.ts`, `packages/providers/src/llm/gemini.ts`, `packages/providers/src/llm/openrouter.ts`
- Create: `packages/providers/src/llm/classify.test.ts`, `packages/providers/src/llm/gemini.test.ts`, `packages/providers/src/llm/openrouter.test.ts`
- Create: `packages/providers/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
  interface LlmRequest { system?: string; prompt: string; jsonSchema?: Record<string, unknown>; temperature?: number; maxOutputTokens?: number }
  interface LlmResult { text: string; modelId: string; provider: ProviderId }
  type LlmErrorKind = "daily_quota" | "rate_limit" | "invalid_request" | "unavailable" | "auth" | "other";
  class LlmError extends Error { readonly kind: LlmErrorKind; readonly status?: number; readonly retryAfterMs?: number }
  interface LlmProvider { readonly id: ProviderId; complete(modelId: string, req: LlmRequest): Promise<LlmResult> }
  class GeminiProvider implements LlmProvider { constructor(apiKey: string, fetchImpl?: FetchLike, baseUrl?: string) }
  class OpenRouterProvider implements LlmProvider { constructor(apiKey: string, fetchImpl?: FetchLike, referer?: string) }
  function classifyHttpError(provider: ProviderId, status: number, bodyText: string, retryAfterHeader: string | null): LlmError
  ```

- [ ] **Step 1: Package skeleton**

`packages/providers/package.json`:
```json
{
  "name": "@wayfare/providers",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "build": "tsc --noEmit" },
  "dependencies": { "@wayfare/domain": "workspace:*", "zod": "^4.1.0" },
  "devDependencies": { "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```
`packages/providers/tsconfig.json` and `vitest.config.ts`: identical to the domain package's.

- [ ] **Step 2: Failing tests for error classification**

`packages/providers/src/llm/classify.test.ts`:
```ts
import { classifyHttpError } from "./classify";

test("gemini 429 mentioning per-day quota is daily_quota", () => {
  const body = JSON.stringify({ error: { message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, per day" } });
  expect(classifyHttpError("google", 429, body, null).kind).toBe("daily_quota");
});

test("gemini 429 per-minute is rate_limit with retryAfter from header", () => {
  const e = classifyHttpError("google", 429, JSON.stringify({ error: { message: "Resource exhausted: requests per minute" } }), "7");
  expect(e.kind).toBe("rate_limit");
  expect(e.retryAfterMs).toBe(7000);
});

test("openrouter 429 mentioning the daily free pool is daily_quota", () => {
  const body = JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day" } });
  expect(classifyHttpError("openrouter", 429, body, null).kind).toBe("daily_quota");
});

test("401/403 are auth; 5xx unavailable; 400 invalid_request", () => {
  expect(classifyHttpError("google", 401, "", null).kind).toBe("auth");
  expect(classifyHttpError("openrouter", 503, "", null).kind).toBe("unavailable");
  expect(classifyHttpError("google", 400, "", null).kind).toBe("invalid_request");
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @wayfare/providers test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement types and classification**

`packages/providers/src/llm/types.ts`:
```ts
import type { ProviderId } from "@wayfare/domain";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LlmRequest {
  system?: string;
  prompt: string;
  /** JSON Schema for the response. Providers without native support get prompt-enforced JSON (router). */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResult {
  text: string;
  modelId: string;
  provider: ProviderId;
}

export type LlmErrorKind = "daily_quota" | "rate_limit" | "invalid_request" | "unavailable" | "auth" | "other";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  readonly id: ProviderId;
  complete(modelId: string, req: LlmRequest): Promise<LlmResult>;
}
```

`packages/providers/src/llm/classify.ts`:
```ts
import type { ProviderId } from "@wayfare/domain";
import { LlmError } from "./types";

const DAILY = [/per day/i, /daily/i, /free-models-per-day/i, /requests_per_day/i, /\bRPD\b/];
const MINUTE = [/per minute/i, /requests_per_minute/i, /\bRPM\b/, /tokens per minute/i];

export function classifyHttpError(provider: ProviderId, status: number, bodyText: string, retryAfterHeader: string | null): LlmError {
  const retryAfterMs = retryAfterHeader && Number.isFinite(Number(retryAfterHeader)) ? Number(retryAfterHeader) * 1000 : undefined;
  const msg = `${provider} HTTP ${status}: ${bodyText.slice(0, 300)}`;
  if (status === 401 || status === 403) return new LlmError("auth", msg, status);
  if (status === 429) {
    const daily = DAILY.some((p) => p.test(bodyText));
    const minute = MINUTE.some((p) => p.test(bodyText));
    if (daily && !minute) return new LlmError("daily_quota", msg, status);
    return new LlmError("rate_limit", msg, status, retryAfterMs ?? 5000);
  }
  if (status >= 500) return new LlmError("unavailable", msg, status, retryAfterMs);
  if (status >= 400) return new LlmError("invalid_request", msg, status);
  return new LlmError("other", msg, status);
}
```

- [ ] **Step 5: Failing tests for the Gemini adapter**

`packages/providers/src/llm/gemini.test.ts`:
```ts
import { GeminiProvider } from "./gemini";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

test("sends key in header, model in path, schema in generationConfig; returns text", async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  const r = await new GeminiProvider("KEY", f.fn).complete("gemini-3.8-flash", { prompt: "hi", jsonSchema: { type: "object" } });
  expect(r).toEqual({ text: '{"ok":true}', modelId: "gemini-3.8-flash", provider: "google" });
  expect(f.calls[0]?.url).toContain("/models/gemini-3.8-flash:generateContent");
  expect(new Headers(f.calls[0]?.init?.headers).get("x-goog-api-key")).toBe("KEY");
  const sent = JSON.parse(String(f.calls[0]?.init?.body));
  expect(sent.generationConfig.responseMimeType).toBe("application/json");
  expect(sent.generationConfig.responseSchema).toEqual({ type: "object" });
});

test("system prompt goes to systemInstruction", async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: "x" }] } }] });
  await new GeminiProvider("KEY", f.fn).complete("m", { prompt: "p", system: "s" });
  expect(JSON.parse(String(f.calls[0]?.init?.body)).systemInstruction).toEqual({ parts: [{ text: "s" }] });
});

test("429 daily quota → LlmError daily_quota", async () => {
  const f = fakeFetch(429, { error: { message: "limit: 20 per day" } });
  await expect(new GeminiProvider("KEY", f.fn).complete("m", { prompt: "hi" })).rejects.toMatchObject({ kind: "daily_quota" });
});

test("empty candidates → LlmError other", async () => {
  const f = fakeFetch(200, { candidates: [] });
  await expect(new GeminiProvider("KEY", f.fn).complete("m", { prompt: "x" })).rejects.toMatchObject({ kind: "other" });
});
```

- [ ] **Step 6: Implement the Gemini adapter**

`packages/providers/src/llm/gemini.ts`:
```ts
import { z } from "zod";
import { classifyHttpError } from "./classify";
import { type FetchLike, LlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

const GeminiResponse = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional() }))
    .optional(),
});

export class GeminiProvider implements LlmProvider {
  readonly id = "google" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async complete(modelId: string, req: LlmRequest): Promise<LlmResult> {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        ...(req.jsonSchema ? { responseMimeType: "application/json", responseSchema: req.jsonSchema } : {}),
      },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

    const res = await this.fetchImpl(`${this.baseUrl}/models/${modelId}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw classifyHttpError("google", res.status, await res.text(), res.headers.get("retry-after"));
    const parsed = GeminiResponse.safeParse(await res.json());
    const text = parsed.success ? parsed.data.candidates?.[0]?.content?.parts.map((p) => p.text ?? "").join("") : undefined;
    if (!text) throw new LlmError("other", "Gemini returned no text candidate", res.status);
    return { text, modelId, provider: "google" };
  }
}
```

- [ ] **Step 7: Failing tests for OpenRouter**

`packages/providers/src/llm/openrouter.test.ts`:
```ts
import { OpenRouterProvider } from "./openrouter";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fn: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

test("OpenAI-compatible request with bearer key, referer and json_schema response_format", async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: '{"ok":true}' } }], model: "qwen/qwen3.8-27b:free" });
  const r = await new OpenRouterProvider("KEY", f.fn, "https://app.test").complete("qwen/qwen3.8-27b:free", { prompt: "hi", system: "sys", jsonSchema: { type: "object" } });
  expect(r.text).toBe('{"ok":true}');
  expect(r.modelId).toBe("qwen/qwen3.8-27b:free");
  expect(f.calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  const h = new Headers(f.calls[0]?.init?.headers);
  expect(h.get("authorization")).toBe("Bearer KEY");
  expect(h.get("http-referer")).toBe("https://app.test");
  const sent = JSON.parse(String(f.calls[0]?.init?.body));
  expect(sent.messages[0]).toEqual({ role: "system", content: "sys" });
  expect(sent.response_format.type).toBe("json_schema");
});

test("daily free limit 429 → daily_quota", async () => {
  const f = fakeFetch(429, { error: { message: "free-models-per-day limit reached" } });
  await expect(new OpenRouterProvider("KEY", f.fn).complete("openrouter/free", { prompt: "x" })).rejects.toMatchObject({ kind: "daily_quota" });
});

test("null content → LlmError other", async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: null } }] });
  await expect(new OpenRouterProvider("KEY", f.fn).complete("m", { prompt: "x" })).rejects.toMatchObject({ kind: "other" });
});
```

- [ ] **Step 8: Implement OpenRouter**

`packages/providers/src/llm/openrouter.ts`:
```ts
import { z } from "zod";
import { classifyHttpError } from "./classify";
import { type FetchLike, LlmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

const ChatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
  model: z.string().optional(),
});

export class OpenRouterProvider implements LlmProvider {
  readonly id = "openrouter" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly referer = "https://tripdesignapp.web.app",
  ) {}

  async complete(modelId: string, req: LlmRequest): Promise<LlmResult> {
    const messages: { role: "system" | "user"; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxOutputTokens ?? 2048,
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: req.jsonSchema } } }
        : {}),
    };
    const res = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "http-referer": this.referer,
        "x-title": "Wayfare",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw classifyHttpError("openrouter", res.status, await res.text(), res.headers.get("retry-after"));
    const parsed = ChatResponse.safeParse(await res.json());
    const text = parsed.success ? parsed.data.choices[0]?.message.content : null;
    if (!text) throw new LlmError("other", "OpenRouter returned no content", res.status);
    return { text, modelId: parsed.success && parsed.data.model ? parsed.data.model : modelId, provider: "openrouter" };
  }
}
```

`packages/providers/src/index.ts`:
```ts
export * from "./llm/types";
export * from "./llm/classify";
export * from "./llm/gemini";
export * from "./llm/openrouter";
```

- [ ] **Step 9: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/providers test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/providers
git commit -m "feat(providers): Gemini and OpenRouter LLM adapters with error classification"
```

---

### Task 5: `ModelRouter` with quota tracking and fallback

**Files:**
- Create: `packages/providers/src/llm/reset.ts`, `packages/providers/src/llm/reset.test.ts`
- Create: `packages/providers/src/llm/memoryQuotaStore.ts`
- Create: `packages/providers/src/llm/router.ts`, `packages/providers/src/llm/router.test.ts`
- Modify: `packages/providers/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  function providerDayKey(provider: ProviderId, now: Date): string    // "YYYY-MM-DD" in America/Los_Angeles for google, UTC for openrouter
  function nextResetIso(provider: ProviderId, now: Date): string      // next local midnight in that zone, ISO instant
  interface QuotaStore {
    isExhausted(modelEntryId: string, now: Date): Promise<boolean>;
    markExhausted(modelEntryId: string, untilIso: string): Promise<void>;
    recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void>;
  }
  class InMemoryQuotaStore implements QuotaStore { exhaustedUntil: Map<string,string>; calls: {id,outcome,at}[] }
  interface RouterAttempt { modelEntryId: string; modelId: string; outcome: "ok" | LlmErrorKind | "skipped_exhausted" | "skipped_no_provider" }
  interface RouterResult extends LlmResult { modelEntryId: string; attempts: RouterAttempt[] }
  interface ModelRouterOptions { registry: ModelRegistry; providers: Partial<Record<ProviderId, LlmProvider>>; quota: QuotaStore; now?: () => Date; sleep?: (ms: number) => Promise<void>; maxRateLimitRetry?: number }
  class ModelRouter { constructor(opts: ModelRouterOptions); run(task: TaskType, req: LlmRequest): Promise<RouterResult> } // throws LlmError kind "daily_quota" when the whole chain fails
  ```

- [ ] **Step 1: Failing tests for reset helpers**

`packages/providers/src/llm/reset.test.ts`:
```ts
import { nextResetIso, providerDayKey } from "./reset";

test("google day key uses Pacific time; openrouter uses UTC", () => {
  // 2026-09-20T05:30Z is 2026-09-19 22:30 in Los Angeles (PDT, UTC-7)
  expect(providerDayKey("google", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-19");
  expect(providerDayKey("openrouter", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-20");
});

test("next reset is the following midnight in the provider zone", () => {
  expect(nextResetIso("openrouter", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-21T00:00:00.000Z");
  expect(nextResetIso("google", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-20T07:00:00.000Z"); // 00:00 PDT
  expect(nextResetIso("google", new Date("2026-09-20T12:00:00Z"))).toBe("2026-09-21T07:00:00.000Z");
});
```

- [ ] **Step 2: Implement reset helpers**

`packages/providers/src/llm/reset.ts`:
```ts
import type { ProviderId } from "@wayfare/domain";

const ZONE: Record<ProviderId, string> = { google: "America/Los_Angeles", openrouter: "UTC" };

function partsIn(zone: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(d)) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day), h: Number(map.hour) % 24, mi: Number(map.minute), s: Number(map.second) };
}

export function providerDayKey(provider: ProviderId, now: Date): string {
  const p = partsIn(ZONE[provider], now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Next local midnight in the provider's reset zone, as an ISO instant. */
export function nextResetIso(provider: ProviderId, now: Date): string {
  const p = partsIn(ZONE[provider], now);
  const secondsSinceMidnight = p.h * 3600 + p.mi * 60 + p.s;
  const msToMidnight = (86400 - secondsSinceMidnight) * 1000 - now.getMilliseconds();
  return new Date(now.getTime() + msToMidnight).toISOString();
}
```

- [ ] **Step 3: QuotaStore interface and in-memory implementation**

`packages/providers/src/llm/memoryQuotaStore.ts`:
```ts
import type { ModelEntry } from "@wayfare/domain";
import type { LlmErrorKind } from "./types";

export interface QuotaStore {
  isExhausted(modelEntryId: string, now: Date): Promise<boolean>;
  markExhausted(modelEntryId: string, untilIso: string): Promise<void>;
  recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void>;
}

export class InMemoryQuotaStore implements QuotaStore {
  readonly exhaustedUntil = new Map<string, string>();
  readonly calls: { id: string; outcome: string; at: string }[] = [];

  async isExhausted(id: string, now: Date): Promise<boolean> {
    const until = this.exhaustedUntil.get(id);
    return until !== undefined && new Date(until).getTime() > now.getTime();
  }

  async markExhausted(id: string, untilIso: string): Promise<void> {
    this.exhaustedUntil.set(id, untilIso);
  }

  async recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void> {
    this.calls.push({ id: entry.id, outcome, at: now.toISOString() });
  }
}
```

- [ ] **Step 4: Failing tests for the router**

`packages/providers/src/llm/router.test.ts`:
```ts
import { loadRegistry } from "@wayfare/domain";
import { InMemoryQuotaStore } from "./memoryQuotaStore";
import { ModelRouter } from "./router";
import { LlmError, type LlmProvider, type LlmRequest } from "./types";

const reg = loadRegistry({
  version: 1,
  models: [
    { id: "g1", provider: "google", modelId: "g1", enabled: true, capabilities: { jsonSchema: true, contextTokens: 1 }, rank: { best: 1 } },
    { id: "g2", provider: "google", modelId: "g2", enabled: true, capabilities: { jsonSchema: true, contextTokens: 1 }, rank: { best: 2 } },
    { id: "o1", provider: "openrouter", modelId: "o1", enabled: true, capabilities: { jsonSchema: false, contextTokens: 1 }, rank: { best: 3 } },
  ],
});

type Script = Record<string, Array<"ok" | LlmError>>;
function scripted(id: "google" | "openrouter", script: Script): LlmProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    calls,
    async complete(modelId: string, _req: LlmRequest) {
      calls.push(modelId);
      const next = script[modelId]?.shift();
      if (next instanceof LlmError) throw next;
      return { text: `from ${modelId}`, modelId, provider: id };
    },
  };
}

const NOW = new Date("2026-09-20T12:00:00Z");

test("first healthy model wins", async () => {
  const google = scripted("google", { g1: ["ok"] });
  const res = await new ModelRouter({ registry: reg, providers: { google }, quota: new InMemoryQuotaStore(), now: () => NOW }).run("best", { prompt: "x" });
  expect(res.modelEntryId).toBe("g1");
  expect(res.attempts.map((a) => a.outcome)).toEqual(["ok"]);
});

test("daily quota marks the model exhausted until the provider reset and falls through", async () => {
  const quota = new InMemoryQuotaStore();
  const google = scripted("google", { g1: [new LlmError("daily_quota", "day")], g2: ["ok"] });
  const res = await new ModelRouter({ registry: reg, providers: { google }, quota, now: () => NOW }).run("best", { prompt: "x" });
  expect(res.modelEntryId).toBe("g2");
  expect(await quota.isExhausted("g1", NOW)).toBe(true);
  expect(quota.exhaustedUntil.get("g1")).toBe("2026-09-21T07:00:00.000Z");
});

test("exhausted models are skipped without calling the provider", async () => {
  const quota = new InMemoryQuotaStore();
  await quota.markExhausted("g1", "2999-01-01T00:00:00.000Z");
  const google = scripted("google", { g2: ["ok"] });
  const res = await new ModelRouter({ registry: reg, providers: { google }, quota, now: () => NOW }).run("best", { prompt: "x" });
  expect(google.calls).toEqual(["g2"]);
  expect(res.attempts[0]).toMatchObject({ modelEntryId: "g1", outcome: "skipped_exhausted" });
});

test("per-minute rate limit retries once after sleeping, then moves on", async () => {
  const sleeps: number[] = [];
  const google = scripted("google", { g1: [new LlmError("rate_limit", "rpm", 429, 1500), new LlmError("rate_limit", "rpm", 429, 1500)], g2: ["ok"] });
  const router = new ModelRouter({ registry: reg, providers: { google }, quota: new InMemoryQuotaStore(), now: () => NOW, sleep: async (ms) => { sleeps.push(ms); } });
  const res = await router.run("best", { prompt: "x" });
  expect(sleeps).toEqual([1500]);
  expect(google.calls).toEqual(["g1", "g1", "g2"]);
  expect(res.modelEntryId).toBe("g2");
});

test("entries whose provider is not configured are skipped; a fully failed chain throws daily_quota", async () => {
  const google = scripted("google", { g1: [new LlmError("unavailable", "503")], g2: [new LlmError("auth", "401")] });
  await expect(new ModelRouter({ registry: reg, providers: { google }, quota: new InMemoryQuotaStore(), now: () => NOW }).run("best", { prompt: "x" })).rejects.toMatchObject({ kind: "daily_quota" });
});

test("every real call is recorded in the quota store", async () => {
  const quota = new InMemoryQuotaStore();
  const google = scripted("google", { g1: [new LlmError("daily_quota", "day")], g2: ["ok"] });
  await new ModelRouter({ registry: reg, providers: { google }, quota, now: () => NOW }).run("best", { prompt: "x" });
  expect(quota.calls.map((c) => `${c.id}:${c.outcome}`)).toEqual(["g1:daily_quota", "g2:ok"]);
});

test("models without native jsonSchema get a prompt-enforced JSON instruction instead", async () => {
  const quota = new InMemoryQuotaStore();
  await quota.markExhausted("g1", "2999-01-01T00:00:00.000Z");
  await quota.markExhausted("g2", "2999-01-01T00:00:00.000Z");
  let seen: LlmRequest | undefined;
  const openrouter: LlmProvider = { id: "openrouter", async complete(modelId, req) { seen = req; return { text: "{}", modelId, provider: "openrouter" }; } };
  await new ModelRouter({ registry: reg, providers: { openrouter }, quota, now: () => NOW }).run("best", { prompt: "x", jsonSchema: { type: "object" } });
  expect(seen?.jsonSchema).toBeUndefined();
  expect(seen?.system).toMatch(/Respond with JSON only/);
});
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @wayfare/providers test`
Expected: FAIL — `./router` not found (reset tests pass).

- [ ] **Step 6: Implement the router**

`packages/providers/src/llm/router.ts`:
```ts
import { type ModelEntry, type ModelRegistry, type ProviderId, type TaskType, chainFor } from "@wayfare/domain";
import type { QuotaStore } from "./memoryQuotaStore";
import { nextResetIso } from "./reset";
import { LlmError, type LlmErrorKind, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export interface RouterAttempt {
  modelEntryId: string;
  modelId: string;
  outcome: "ok" | LlmErrorKind | "skipped_exhausted" | "skipped_no_provider";
}

export interface RouterResult extends LlmResult {
  modelEntryId: string;
  attempts: RouterAttempt[];
}

export interface ModelRouterOptions {
  registry: ModelRegistry;
  providers: Partial<Record<ProviderId, LlmProvider>>;
  quota: QuotaStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Retries of the same model on a per-minute 429 before moving on. */
  maxRateLimitRetry?: number;
}

const JSON_ONLY_SYSTEM = "Respond with JSON only. No prose, no markdown fences. The JSON must conform to this JSON Schema:\n";

export class ModelRouter {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRateLimitRetry: number;

  constructor(private readonly opts: ModelRouterOptions) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRateLimitRetry = opts.maxRateLimitRetry ?? 1;
  }

  async run(task: TaskType, req: LlmRequest): Promise<RouterResult> {
    const attempts: RouterAttempt[] = [];
    for (const entry of chainFor(this.opts.registry, task)) {
      const provider = this.opts.providers[entry.provider];
      if (!provider) {
        attempts.push({ modelEntryId: entry.id, modelId: entry.modelId, outcome: "skipped_no_provider" });
        continue;
      }
      if (await this.opts.quota.isExhausted(entry.id, this.now())) {
        attempts.push({ modelEntryId: entry.id, modelId: entry.modelId, outcome: "skipped_exhausted" });
        continue;
      }
      const effective = adaptRequest(entry, req);
      let rateLimitRetries = 0;
      for (;;) {
        try {
          const result = await provider.complete(entry.modelId, effective);
          await this.opts.quota.recordCall(entry, "ok", this.now());
          attempts.push({ modelEntryId: entry.id, modelId: entry.modelId, outcome: "ok" });
          return { ...result, modelEntryId: entry.id, attempts };
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError("other", String(err));
          await this.opts.quota.recordCall(entry, e.kind, this.now());
          if (e.kind === "rate_limit" && rateLimitRetries < this.maxRateLimitRetry) {
            rateLimitRetries += 1;
            await this.sleep(e.retryAfterMs ?? 5000);
            continue;
          }
          if (e.kind === "daily_quota") {
            await this.opts.quota.markExhausted(entry.id, nextResetIso(entry.provider, this.now()));
          }
          attempts.push({ modelEntryId: entry.id, modelId: entry.modelId, outcome: e.kind });
          break;
        }
      }
    }
    throw new LlmError(
      "daily_quota",
      `All models in chain "${task}" failed or are exhausted: ${attempts.map((a) => `${a.modelEntryId}=${a.outcome}`).join(", ")}`,
    );
  }
}

/** Models without native JSON-schema output get the schema in the system prompt (spec §3.4). */
function adaptRequest(entry: ModelEntry, req: LlmRequest): LlmRequest {
  if (!req.jsonSchema || entry.capabilities.jsonSchema) return req;
  const { jsonSchema, ...rest } = req;
  const system = `${req.system ? `${req.system}\n\n` : ""}${JSON_ONLY_SYSTEM}${JSON.stringify(jsonSchema)}`;
  return { ...rest, system };
}
```

Add to `packages/providers/src/index.ts`:
```ts
export * from "./llm/reset";
export * from "./llm/memoryQuotaStore";
export * from "./llm/router";
```

- [ ] **Step 7: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/providers test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/providers
git commit -m "feat(providers): ModelRouter with quota-aware fallback chain and provider reset times"
```

---

### Task 6: Cloudflare Worker scaffold — Hono app, CORS lock, security headers, `/health`

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.toml`, `apps/api/vitest.config.ts`, `apps/api/.dev.vars.example`
- Create: `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/http/errors.ts`, `apps/api/src/middleware/cors.ts`, `apps/api/src/middleware/securityHeaders.ts`
- Create: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Env { CONFIG_KV: KVNamespace; FIREBASE_PROJECT_ID: string; ALLOWED_ORIGIN: string; ADMIN_UIDS: string; GEMINI_API_KEY: string; OPENROUTER_API_KEY: string; TAVILY_API_KEY: string; FIREBASE_SERVICE_ACCOUNT: string; FIREBASE_AUTH_EMULATOR_HOST?: string; FIRESTORE_EMULATOR_HOST?: string }
  const rateLimit: (opts?: { limit?: number; windowMs?: number }) => MiddlewareHandler<AppEnv>   // in-memory token bucket per IP (+ per uid when present); 429 rate_limited when exceeded. Phase 6 hardening baseline.
  interface AppDeps { jwks?: JWTVerifyGetKey; fetchImpl?: FetchLike; now?: () => Date }
  interface AppVariables { deps: { fetchImpl: FetchLike; now: () => Date; jwks?: JWTVerifyGetKey }; user: AuthUser /* set by firebaseAuth */ }
  type AppEnv = { Bindings: Env; Variables: AppVariables }
  function createApp(deps?: AppDeps): Hono<AppEnv>
  function apiError(c: Context, status: ContentfulStatusCode, code: ApiErrorCode, message: string): Response
  ```
  Route this task: `GET /health → { ok: true, service: "api" }`.

- [ ] **Step 1: Package and wrangler config**

`apps/api/package.json`:
```json
{
  "name": "@wayfare/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@wayfare/domain": "workspace:*",
    "@wayfare/providers": "workspace:*",
    "hono": "^4.9.0",
    "jose": "^6.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.9.0",
    "@cloudflare/workers-types": "^4.20260901.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.30.0"
  }
}
```

`apps/api/wrangler.toml` (fill `<project>` from Task 0; `<kv-id>` from Step 2; `ALLOWED_ORIGIN` is switched to the real origin in Task 13):
```toml
name = "wayfare-api"
main = "src/index.ts"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat"]

[vars]
FIREBASE_PROJECT_ID = "<project>"
ALLOWED_ORIGIN = "https://<project>.web.app"

[[kv_namespaces]]
binding = "CONFIG_KV"
id = "<kv-id>"

[observability]
enabled = true
```

`apps/api/.dev.vars.example` (copy to `.dev.vars`, git-ignored; `.dev.vars` overrides `[vars]` locally; `dev.bat` creates the file with these keys if missing):
```
ALLOWED_ORIGIN=http://localhost:5173
GEMINI_API_KEY=
OPENROUTER_API_KEY=
TAVILY_API_KEY=
ADMIN_UIDS=
FIREBASE_SERVICE_ACCOUNT=
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "lib": ["ES2022"], "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers", "vitest/globals"] },
  "include": ["src", "test"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            FIREBASE_PROJECT_ID: "test-project",
            ALLOWED_ORIGIN: "https://app.test",
            ADMIN_UIDS: "admin-uid-1,admin-uid-2",
            GEMINI_API_KEY: "g",
            OPENROUTER_API_KEY: "o",
            TAVILY_API_KEY: "t",
            FIREBASE_SERVICE_ACCOUNT: "{}",
          },
          kvNamespaces: ["CONFIG_KV"],
        },
      },
    },
  },
});
```

- [ ] **Step 2: Create the KV namespace**

Run: `cd apps/api && pnpm dlx wrangler@4 kv namespace create CONFIG_KV`
Copy the printed `id` into `wrangler.toml`.

- [ ] **Step 3: Failing test**

`apps/api/test/health.test.ts`:
```ts
import { env } from "cloudflare:test";
import { createApp } from "../src/app";

const app = createApp();

const SECURITY_HEADERS: Record<string, string | RegExp> = {
  "strict-transport-security": /max-age=\d+/,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": /frame-ancestors 'none'/,
  "permissions-policy": /geolocation=\(\)/,
  "cache-control": "no-store",
};

function expectSecurityHeaders(res: Response) {
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const v = res.headers.get(name);
    if (typeof expected === "string") expect(v, name).toBe(expected);
    else expect(v ?? "", name).toMatch(expected);
  }
}

test("GET /health is public and carries every security header", async () => {
  const res = await app.request("/health", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: "api" });
  expectSecurityHeaders(res);
});

test("security headers are present on 404 and 401 responses too", async () => {
  expectSecurityHeaders(await app.request("/nope", {}, env));
  expectSecurityHeaders(await app.request("/ping", {}, env)); // 401 once Task 7 lands; 404 before — headers must be there either way
});

test("CORS: foreign Origin gets no Access-Control-Allow-Origin; allowed origin does, including preflight", async () => {
  const ok = await app.request("/health", { headers: { origin: "https://app.test" } }, env);
  expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.test");
  expect(ok.headers.get("vary")).toContain("Origin");

  const bad = await app.request("/health", { headers: { origin: "https://evil.test" } }, env);
  expect(bad.headers.get("access-control-allow-origin")).toBeNull();

  const badPreflight = await app.request("/ping", { method: "OPTIONS", headers: { origin: "https://evil.test", "access-control-request-method": "GET" } }, env);
  expect(badPreflight.headers.get("access-control-allow-origin")).toBeNull();

  const goodPreflight = await app.request("/ping", { method: "OPTIONS", headers: { origin: "https://app.test", "access-control-request-method": "GET", "access-control-request-headers": "authorization" } }, env);
  expect(goodPreflight.status).toBe(204);
  expect(goodPreflight.headers.get("access-control-allow-origin")).toBe("https://app.test");
  expect(goodPreflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  expect(goodPreflight.headers.get("access-control-allow-methods")).toContain("GET");
});

test("unknown route returns JSON 404", async () => {
  const res = await app.request("/nope", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found", message: "Not found" });
});

test("an unexpected exception returns a generic 500 with no stack trace or message leakage", async () => {
  const boom = createApp();
  boom.get("/boom", () => {
    throw new Error("secret internal detail: db password is hunter2");
  });
  const res = await boom.request("/boom", {}, env);
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: "internal", message: "Internal error" });
  expect(text).not.toMatch(/hunter2|at .*\.ts:\d+|Error:/);
  expectSecurityHeaders(res);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm install && pnpm --filter @wayfare/api test`
Expected: FAIL — `../src/app` not found.

- [ ] **Step 5: Implement env, errors, middleware, app**

`apps/api/src/env.ts`:
```ts
export interface Env {
  CONFIG_KV: KVNamespace;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  /** Comma-separated Firebase UIDs. Worker secret. */
  ADMIN_UIDS: string;
  GEMINI_API_KEY: string;
  OPENROUTER_API_KEY: string;
  TAVILY_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  /** Set ONLY by dev.bat via `wrangler dev --var`; when present, tokens from the Auth emulator are accepted (Task 7). Never set in production. */
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** Set ONLY by dev.bat; Firestore REST calls go to the emulator (Task 9). */
  FIRESTORE_EMULATOR_HOST?: string;
}
```

`apps/api/src/http/errors.ts`:
```ts
import type { ApiErrorCode } from "@wayfare/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function apiError(c: Context, status: ContentfulStatusCode, code: ApiErrorCode, message: string): Response {
  return c.json({ error: code, message }, status);
}
```

`apps/api/src/middleware/securityHeaders.ts`:
```ts
import type { MiddlewareHandler } from "hono";

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("x-frame-options", "DENY");
  c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  c.header("permissions-policy", "geolocation=(), camera=(), microphone=(), payment=()");
  c.header("cache-control", "no-store");
};
```

`apps/api/src/middleware/cors.ts`:
```ts
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../env";

/** Exactly one allowed origin (spec §8). Other origins get no CORS headers at all. */
export const lockedCors: MiddlewareHandler<{ Bindings: Env }> = (c, next) =>
  cors({
    origin: (origin) => (origin === c.env.ALLOWED_ORIGIN ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["authorization", "content-type"],
    maxAge: 600,
  })(c, next);
```

`apps/api/src/app.ts`:
```ts
import type { FetchLike } from "@wayfare/providers";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { AuthUser } from "./auth/verifyIdToken";
import type { Env } from "./env";
import { apiError } from "./http/errors";
import { lockedCors } from "./middleware/cors";
import { securityHeaders } from "./middleware/securityHeaders";

export interface AppDeps {
  /** Injected in tests; defaults to Google's Firebase JWKS. */
  jwks?: JWTVerifyGetKey;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface AppVariables {
  deps: { fetchImpl: FetchLike; now: () => Date; jwks?: JWTVerifyGetKey };
  /** Populated by firebaseAuth; only read behind that middleware. */
  user: AuthUser;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };

export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const resolved: AppVariables["deps"] = {
    fetchImpl: deps.fetchImpl ?? ((i, init) => fetch(i, init)),
    now: deps.now ?? (() => new Date()),
    ...(deps.jwks ? { jwks: deps.jwks } : {}),
  };

  app.use("*", async (c, next) => {
    c.set("deps", resolved);
    await next();
  });
  app.use("*", securityHeaders);
  app.use("*", lockedCors);

  app.get("/health", (c) => c.json({ ok: true, service: "api" }));

  app.notFound((c) => apiError(c, 404, "not_found", "Not found"));
  app.onError((err, c) => {
    console.error(JSON.stringify({ level: "error", path: c.req.path, message: err.message }));
    return apiError(c, 500, "internal", "Internal error");
  });
  return app;
}
```
(`./auth/verifyIdToken` is created in Task 7; until then, temporarily declare `export interface AuthUser { uid: string }` in a stub file `apps/api/src/auth/verifyIdToken.ts` so this compiles. Task 7 replaces the stub.)

`apps/api/src/index.ts`:
```ts
import { createApp } from "./app";
import type { Env } from "./env";

const app = createApp();
export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/api test && pnpm lint && pnpm typecheck`
Expected: all health/CORS/header/error tests PASS.

- [ ] **Step 7: Failing test — rate-limit baseline (Phase 6 hardening, stubbed now)** (security)

`apps/api/test/rateLimit.test.ts`:
```ts
import { env } from "cloudflare:test";
import { createApp } from "../src/app";

test("the 61st request from one IP within a minute gets 429 rate_limited; another IP is unaffected", async () => {
  const app = createApp({ now: () => new Date("2026-09-20T12:00:00Z") });
  const from = (ip: string) => app.request("/health", { headers: { "cf-connecting-ip": ip } }, env);
  for (let i = 0; i < 60; i += 1) expect((await from("203.0.113.7")).status).toBe(200);
  const blocked = await from("203.0.113.7");
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toMatchObject({ error: "rate_limited" });
  expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  expect((await from("203.0.113.8")).status).toBe(200);
});

test("the bucket refills after the window", async () => {
  let t = Date.parse("2026-09-20T12:00:00Z");
  const app = createApp({ now: () => new Date(t) });
  const from = () => app.request("/health", { headers: { "cf-connecting-ip": "203.0.113.9" } }, env);
  for (let i = 0; i < 60; i += 1) await from();
  expect((await from()).status).toBe(429);
  t += 61_000;
  expect((await from()).status).toBe(200);
});
```

`apps/api/src/middleware/rateLimit.ts`:
```ts
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { apiError } from "../http/errors";

/**
 * Phase 0 baseline for spec §8 "per-IP and per-UID rate limits".
 * In-memory per isolate: good enough to stop a single-client loop, not a
 * distributed guarantee. Phase 6 replaces the store with KV/Durable Objects
 * and adds App Check. Keyed by IP, and additionally by uid once auth ran.
 */
export function rateLimit(opts: { limit?: number; windowMs?: number } = {}): MiddlewareHandler<AppEnv> {
  const limit = opts.limit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const now = c.get("deps").now().getTime();
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
    const keys = uid ? [`ip:${ip}`, `uid:${uid}`] : [`ip:${ip}`];
    for (const key of keys) {
      const b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        continue;
      }
      if (b.count >= limit) {
        c.header("retry-after", String(Math.ceil((b.resetAt - now) / 1000)));
        return apiError(c, 429, "rate_limited", "Too many requests");
      }
      b.count += 1;
    }
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    await next();
  };
}
```
Register in `createApp` right after `lockedCors`: `app.use("*", rateLimit());` (import it). Because `createApp` builds a new `Map` per app instance, tests are isolated.

Run: `pnpm --filter @wayfare/api test` — Expected: rate-limit tests PASS, the earlier tests still PASS (they make fewer than 60 requests per IP; they send no `cf-connecting-ip`, so they share the `unknown` bucket — keep each test file under 60 unauthenticated requests or set distinct IPs).

- [ ] **Step 8: Local smoke**

Run: `cd apps/api && copy .dev.vars.example .dev.vars && pnpm dev`, then in another shell `curl.exe -i http://localhost:8787/health`.
Expected: `200` with `{"ok":true,"service":"api"}` and the security headers. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): Hono worker scaffold with locked CORS, security headers, error hygiene and rate-limit baseline"
```

---

### Task 7: Firebase ID-token verification and the protected `/ping`

**Files:**
- Create (replace stub): `apps/api/src/auth/verifyIdToken.ts`
- Create: `apps/api/src/auth/middleware.ts`, `apps/api/test/helpers/tokens.ts`, `apps/api/test/auth.test.ts`
- Modify: `apps/api/src/app.ts` (register `/ping`)

**Interfaces:**
- Produces:
  ```ts
  interface AuthUser { uid: string; email?: string; emailVerified: boolean; authTime: number /* epoch seconds */ }
  type AuthErrorCode = "invalid" | "email_unverified"
  class AuthError extends Error { readonly code: AuthErrorCode }
  function firebaseJwks(): JWTVerifyGetKey
  function verifyIdToken(token: string, projectId: string, getKey: JWTVerifyGetKey, now: Date): Promise<AuthUser>
  const firebaseAuth: MiddlewareHandler<AppEnv>   // sets c.var.user or returns 401 { error: "unauthorized" }
  // test helper
  const TEST_PROJECT = "test-project"
  function makeTestJwks(): Promise<{ getKey: JWTVerifyGetKey; sign(claims, opts?: { expiresIn?: string }): Promise<string>; signWithForeignKey(claims): Promise<string> }>
  ```
  Route: `GET /ping` (auth) → `PingResponse` with `firstSeen: false` (Task 9 wires Firestore and real `firstSeen`).

- [ ] **Step 1: Test token helper**

`apps/api/test/helpers/tokens.ts`:
```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";

export const TEST_PROJECT = "test-project";

export interface TestJwks {
  getKey: JWTVerifyGetKey;
  sign(claims?: Record<string, unknown>, opts?: { expiresIn?: string }): Promise<string>;
  /** Signed with a key that is NOT in the JWKS — must fail verification. */
  signWithForeignKey(claims?: Record<string, unknown>): Promise<string>;
  /** `alg: "none"` token (what the Firebase Auth emulator issues) — must fail unless emulator mode is on. */
  unsecured(claims?: Record<string, unknown>): Promise<string>;
  /** HS256 token signed with a symmetric secret — must always fail (algorithm confusion). */
  signHs256(claims?: Record<string, unknown>): Promise<string>;
}

export async function makeTestJwks(): Promise<TestJwks> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-kid";
  jwk.alg = "RS256";
  jwk.use = "sig";
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const base = (claims: Record<string, unknown>) => ({
    iss: `https://securetoken.google.com/${TEST_PROJECT}`,
    aud: TEST_PROJECT,
    sub: "user-1",
    email: "u@example.com",
    email_verified: true,
    auth_time: Math.floor(Date.now() / 1000) - 60,
    ...claims,
  });
  const signWith = (key: CryptoKey, claims: Record<string, unknown>, expiresIn: string) =>
    new SignJWT(base(claims)).setProtectedHeader({ alg: "RS256", kid: "test-kid" }).setIssuedAt().setExpirationTime(expiresIn).sign(key);
  return {
    getKey,
    sign: (claims = {}, opts = {}) => signWith(privateKey, claims, opts.expiresIn ?? "1h"),
    signWithForeignKey: (claims = {}) => signWith(foreign.privateKey, claims, "1h"),
    unsecured: async (claims = {}) => new UnsecuredJWT(base(claims)).setIssuedAt().setExpirationTime("1h").encode(),
    signHs256: async (claims = {}) =>
      new SignJWT(base(claims)).setProtectedHeader({ alg: "HS256", kid: "test-kid" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode("not-a-secret-anyone-can-guess")),
  };
}
```
(Add `UnsecuredJWT` to the `jose` import.)

- [ ] **Step 2: Failing tests**

`apps/api/test/auth.test.ts`:
```ts
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");

test("no token → 401 unauthorized", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const res = await app.request("/ping", {}, env);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("valid token → 200 with uid and serverTime", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const token = await jwks.sign({ sub: "abc123" });
  const res = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, uid: "abc123", serverTime: NOW.toISOString() });
});

test.each([
  ["wrong audience", (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.sign({ aud: "other-project" })],
  ["wrong issuer", (j) => j.sign({ iss: "https://securetoken.google.com/other" })],
  ["foreign signing key", (j) => j.signWithForeignKey()],
  ["expired", (j) => j.sign({ exp: Math.floor(NOW.getTime() / 1000) - 10 })],
  ["alg none (unsecured)", (j) => j.unsecured()],
  ["alg HS256 (algorithm confusion)", (j) => j.signHs256()],
  ["missing sub", (j) => j.sign({ sub: undefined })],
  ["empty sub", (j) => j.sign({ sub: "" })],
  ["email_verified false", (j) => j.sign({ email_verified: false })],
  ["email_verified absent", (j) => j.sign({ email_verified: undefined })],
  ["auth_time in the future", (j) => j.sign({ auth_time: Math.floor(NOW.getTime() / 1000) + 3600 })],
] as const)("rejects a token with %s → 401", async (_label, make) => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const token = await make(jwks);
  const res = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("malformed Authorization headers → 401 (no scheme, wrong scheme, garbage token)", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  for (const authorization of ["", "Basic abc", "Bearer", "Bearer not.a.jwt", "Token x.y.z"]) {
    const res = await app.request("/ping", { headers: authorization ? { authorization } : {} }, env);
    expect(res.status, authorization).toBe(401);
  }
});

test("emulator mode: unsigned Auth-emulator tokens are accepted ONLY when FIREBASE_AUTH_EMULATOR_HOST is set", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const token = await jwks.unsecured({ sub: "emu-user" });
  const prod = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(prod.status).toBe(401);
  const dev = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, { ...env, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" });
  expect(dev.status).toBe(200);
  expect(await dev.json()).toMatchObject({ uid: "emu-user" });
  // even in emulator mode, iss/aud/exp/email_verified still apply
  const badAud = await app.request("/ping", { headers: { authorization: `Bearer ${await jwks.unsecured({ aud: "other" })}` } }, { ...env, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" });
  expect(badAud.status).toBe(401);
});
```
(Once Task 9 lands, these tests also pass `fetchImpl: fakeFirestore().fetchImpl` and the `FIREBASE_SERVICE_ACCOUNT` env override, as described there.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @wayfare/api test`
Expected: FAIL — `/ping` is 404 and `./middleware` is missing.

- [ ] **Step 4: Implement verification (replacing the Task 6 stub)**

`apps/api/src/auth/verifyIdToken.ts`:
```ts
import { type JWTVerifyGetKey, UnsecuredJWT, createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  /** Seconds since epoch of the user's last sign-in (Firebase `auth_time`). */
  authTime: number;
}

export type AuthErrorCode = "invalid" | "email_unverified";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let cached: JWTVerifyGetKey | undefined;

export function firebaseJwks(): JWTVerifyGetKey {
  cached ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), { cooldownDuration: 30_000, cacheMaxAge: 6 * 60 * 60 * 1000 });
  return cached;
}

export interface VerifyOptions {
  /**
   * Dev only. When true, accept the Auth emulator's unsigned (`alg: "none"`) tokens
   * but still enforce iss/aud/exp/sub/email_verified. The Worker sets this solely
   * from `env.FIREBASE_AUTH_EMULATOR_HOST`, which dev.bat passes via `wrangler dev --var`
   * and which is never defined in production.
   */
  emulator?: boolean;
}

/** Spec §8: RS256, iss, aud, exp, sub non-empty, email_verified === true. */
export async function verifyIdToken(token: string, projectId: string, getKey: JWTVerifyGetKey, now: Date, opts: VerifyOptions = {}): Promise<AuthUser> {
  let payload: Record<string, unknown>;
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  try {
    if (opts.emulator && token.split(".")[0] && JSON.parse(atob(token.split(".")[0] ?? "")).alg === "none") {
      const { payload: p } = UnsecuredJWT.decode(token, { issuer: expectedIss, audience: projectId, currentDate: now });
      payload = p as Record<string, unknown>;
    } else {
      const res = await jwtVerify(token, getKey, { algorithms: ["RS256"], issuer: expectedIss, audience: projectId, currentDate: now });
      payload = res.payload as Record<string, unknown>;
    }
  } catch (e) {
    throw new AuthError("invalid", `Token verification failed: ${(e as Error).message}`);
  }
  const uid = typeof payload.sub === "string" ? payload.sub : "";
  if (!uid) throw new AuthError("invalid", "Token has no subject");
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : 0;
  if (!authTime || authTime > Math.floor(now.getTime() / 1000) + 60) throw new AuthError("invalid", "Invalid auth_time");
  if (payload.email_verified !== true) throw new AuthError("email_unverified", "Email not verified");
  const email = typeof payload.email === "string" ? payload.email : undefined;
  return { uid, ...(email ? { email } : {}), emailVerified: true, authTime };
}
```

`apps/api/src/auth/middleware.ts`:
```ts
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { apiError } from "../http/errors";
import { AuthError, firebaseJwks, verifyIdToken } from "./verifyIdToken";

export const firebaseAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(c, 401, "unauthorized", "Missing bearer token");
  const deps = c.get("deps");
  try {
    const emulator = Boolean(c.env.FIREBASE_AUTH_EMULATOR_HOST);
    if (emulator) console.warn(JSON.stringify({ level: "warn", message: "AUTH EMULATOR MODE: accepting unsigned tokens" }));
    const user = await verifyIdToken(token, c.env.FIREBASE_PROJECT_ID, deps.jwks ?? firebaseJwks(), deps.now(), { emulator });
    c.set("user", user);
  } catch (e) {
    return apiError(c, 401, "unauthorized", e instanceof AuthError ? e.message : "Invalid token");
  }
  await next();
};
```

- [ ] **Step 5: Register `/ping` in `app.ts`** (temporary inline handler; Task 9 moves it to `routes/ping.ts`)

```ts
import type { PingResponse } from "@wayfare/domain";
import { firebaseAuth } from "./auth/middleware";
// inside createApp, after /health:
app.get("/ping", firebaseAuth, (c) => {
  const user = c.get("user");
  const body: PingResponse = { ok: true, uid: user.uid, serverTime: c.get("deps").now().toISOString(), firstSeen: false };
  return c.json(body);
});
```

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/api test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): Firebase ID token verification with jose and protected GET /ping"
```

---

### Task 8: Admin guard — hardcoded UIDs and fresh re-auth

**Files:**
- Create: `apps/api/src/auth/admin.ts`, `apps/api/src/routes/admin.ts`, `apps/api/test/admin.test.ts`
- Modify: `apps/api/src/app.ts` (`app.route("/admin", adminRoutes)`)

**Interfaces:**
- Produces:
  ```ts
  function parseAdminUids(raw: string): Set<string>
  function requireAdmin(opts?: { freshAuthMaxAgeSec?: number }): MiddlewareHandler<AppEnv>   // 403 forbidden if uid ∉ ADMIN_UIDS; for non-GET/HEAD, 401 reauth_required if now − auth_time > maxAge (default DEFAULT_CONFIG.admin.freshAuthMaxAgeSec)
  const adminRoutes: Hono<AppEnv>   // GET /ping → AdminPingResponse; POST /echo → { ok: true }
  ```

- [ ] **Step 1: Failing tests**

`apps/api/test/admin.test.ts`:
```ts
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

async function setup() {
  const jwks = await makeTestJwks();
  return { jwks, app: createApp({ jwks: jwks.getKey, now: () => NOW }) };
}

test("non-admin uid → 403 forbidden", async () => {
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "someone-else", auth_time: nowSec - 10 });
  const res = await app.request("/admin/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "forbidden" });
});

test("admin uid → 200 with authAgeSec", async () => {
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "admin-uid-1", auth_time: nowSec - 120 });
  const res = await app.request("/admin/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, uid: "admin-uid-1", authAgeSec: 120 });
});

test("GET with stale auth is fine; POST with stale auth → 401 reauth_required; fresh POST → 200", async () => {
  const { jwks, app } = await setup();
  const stale = await jwks.sign({ sub: "admin-uid-2", auth_time: nowSec - 16 * 60 });
  expect((await app.request("/admin/ping", { headers: { authorization: `Bearer ${stale}` } }, env)).status).toBe(200);
  const post = await app.request("/admin/echo", { method: "POST", headers: { authorization: `Bearer ${stale}`, "content-type": "application/json" }, body: "{}" }, env);
  expect(post.status).toBe(401);
  expect(await post.json()).toMatchObject({ error: "reauth_required" });
  const fresh = await jwks.sign({ sub: "admin-uid-2", auth_time: nowSec - 14 * 60 });
  expect((await app.request("/admin/echo", { method: "POST", headers: { authorization: `Bearer ${fresh}`, "content-type": "application/json" }, body: "{}" }, env)).status).toBe(200);
});

test("admin routes still require a valid token", async () => {
  const { app } = await setup();
  expect((await app.request("/admin/ping", {}, env)).status).toBe(401);
});

test("non-admin gets 403 on EVERY /admin/* route, including unknown ones (guard runs before routing)", async () => {
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "someone-else", auth_time: nowSec - 10 });
  for (const [method, path] of [["GET", "/admin/ping"], ["POST", "/admin/echo"], ["POST", "/admin/llm/ping"], ["GET", "/admin/does-not-exist"], ["DELETE", "/admin/users/x"]] as const) {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}` } }, env);
    expect(res.status, `${method} ${path}`).toBe(403);
  }
});

test("ADMIN_UIDS parsing ignores whitespace and empty entries; an empty secret grants nobody", async () => {
  const { parseAdminUids } = await import("../src/auth/admin");
  expect([...parseAdminUids(" a , b ,, c ,")]).toEqual(["a", "b", "c"]);
  expect(parseAdminUids("").size).toBe(0);
  expect(parseAdminUids(" , ").size).toBe(0);
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "admin-uid-1", auth_time: nowSec - 10 });
  const res = await app.request("/admin/ping", { headers: { authorization: `Bearer ${token}` } }, { ...env, ADMIN_UIDS: "" });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wayfare/api test`
Expected: FAIL — 404 on `/admin/ping`.

- [ ] **Step 3: Implement**

`apps/api/src/auth/admin.ts`:
```ts
import { DEFAULT_CONFIG } from "@wayfare/domain";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { apiError } from "../http/errors";

export function parseAdminUids(raw: string): Set<string> {
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Spec §8 locks #2/#3: UID must be in the ADMIN_UIDS secret; state-changing
 * requests need a sign-in newer than freshAuthMaxAgeSec (default 15 min).
 */
export function requireAdmin(opts: { freshAuthMaxAgeSec?: number } = {}): MiddlewareHandler<AppEnv> {
  const maxAge = opts.freshAuthMaxAgeSec ?? DEFAULT_CONFIG.admin.freshAuthMaxAgeSec;
  return async (c, next) => {
    const user = c.get("user");
    if (!parseAdminUids(c.env.ADMIN_UIDS).has(user.uid)) return apiError(c, 403, "forbidden", "Admin only");
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      const ageSec = Math.floor(c.get("deps").now().getTime() / 1000) - user.authTime;
      if (ageSec > maxAge) return apiError(c, 401, "reauth_required", "Please sign in again to perform admin changes");
    }
    await next();
  };
}
```

`apps/api/src/routes/admin.ts`:
```ts
import type { AdminPingResponse } from "@wayfare/domain";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { requireAdmin } from "../auth/admin";
import { firebaseAuth } from "../auth/middleware";

export const adminRoutes = new Hono<AppEnv>();
// Guard first, for every method and path under /admin — unknown admin paths return 403 to non-admins, not 404.
adminRoutes.use("*", firebaseAuth, requireAdmin());

adminRoutes.get("/ping", (c) => {
  const user = c.get("user");
  const authAgeSec = Math.max(0, Math.floor(c.get("deps").now().getTime() / 1000) - user.authTime);
  const body: AdminPingResponse = { ok: true, uid: user.uid, authAgeSec };
  return c.json(body);
});

adminRoutes.post("/echo", (c) => c.json({ ok: true }));
```

In `app.ts`: `import { adminRoutes } from "./routes/admin";` and, after `/ping`, `app.route("/admin", adminRoutes);`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/api test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): admin guard by hardcoded UID secret with 15-minute fresh re-auth"
```

---

### Task 9: Firestore REST client with service-account auth; `/ping` creates `users/{uid}` and touches metrics

**Files:**
- Create: `apps/api/src/firestore/serviceAccount.ts`, `apps/api/src/firestore/values.ts`, `apps/api/src/firestore/client.ts`, `apps/api/src/routes/ping.ts`
- Create: `apps/api/test/helpers/fakeFirestore.ts`, `apps/api/test/helpers/testPem.ts`, `apps/api/test/firestore.test.ts`, `apps/api/test/ping.test.ts`
- Modify: `apps/api/src/app.ts` (replace inline `/ping` with `app.route("/ping", pingRoutes)`), `apps/api/test/auth.test.ts` (use the fake Firestore + `TEST_PEM` env override)

**Interfaces:**
- Produces:
  ```ts
  interface ServiceAccount { client_email: string; private_key: string }
  function parseServiceAccount(raw: string): ServiceAccount
  function getAccessToken(sa: ServiceAccount, kv: KVNamespace, fetchImpl: FetchLike, now: Date): Promise<string>  // KV key "sa_access_token", TTL ≈ expires_in − 300s
  type FirestoreValue = …; function toFirestoreValue(v: unknown): FirestoreValue; function fromFirestoreDocument(doc: { fields?: Record<string, FirestoreValue> }): Record<string, unknown>
  class FirestoreClient {
    constructor(opts: { projectId: string; tokenProvider: () => Promise<string>; fetchImpl: FetchLike })
    getDocument(path: string): Promise<Record<string, unknown> | null>
    patchDocument(path: string, fields: Record<string, unknown>, opts?: { updateMask?: string[]; mustExist?: boolean; mustNotExist?: boolean }): Promise<void>
    incrementFields(path: string, increments: Record<string, number>): Promise<void>   // :commit fieldTransforms; creates the doc if missing
  }
  function firestoreFor(env: Env, fetchImpl: FetchLike, now: () => Date): FirestoreClient
  const pingRoutes: Hono<AppEnv>
  // test helpers
  function fakeFirestore(): { docs: Map<string, Record<string, unknown>>; fetchImpl: FetchLike }
  const TEST_PEM: string
  ```
  `/ping` behaviour: read `users/{uid}`; if missing → create `{ createdAt, lastActiveDate, tier: "free", tierSource: "none", freeGenerationUsed: false, plusRequested: false, locale: "en" }`, `metrics/global.totalUsers += 1`, `metricsDaily/{utcDay}.newUsers += 1, activeUsers += 1`, `firstSeen: true`; else if `lastActiveDate !== today` → set it and `metricsDaily/{today}.activeUsers += 1`.

- [ ] **Step 1: Test helpers**

`apps/api/test/helpers/testPem.ts` — generate a throwaway 2048-bit key once and paste it (test-only, never a real key):
```powershell
node -e "const {generateKeyPairSync}=require('crypto');console.log(generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}))"
```
```ts
/** Throwaway PKCS8 RSA key for tests. The fake token endpoint ignores the assertion; jose only needs a parseable key. */
export const TEST_PEM = `-----BEGIN PRIVATE KEY-----
<paste generated key>
-----END PRIVATE KEY-----`;
export const TEST_SA_JSON = JSON.stringify({ client_email: "sa@test", private_key: TEST_PEM });
```

`apps/api/test/helpers/fakeFirestore.ts`:
```ts
/** Minimal in-memory Firestore REST fake: GET document, PATCH (upsert), :commit increments, plus the OAuth token endpoint. */
export function fakeFirestore(projectId = "test-project") {
  const docs = new Map<string, Record<string, unknown>>();
  const prefix = `/v1/projects/${projectId}/databases/(default)/documents/`;

  const encode = (v: unknown) =>
    typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v as number };
  const decode = (v: Record<string, unknown>): unknown =>
    "stringValue" in v ? v.stringValue : "booleanValue" in v ? v.booleanValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : null;

  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });
    const u = new URL(url);
    if (u.pathname.endsWith(":commit")) {
      const body = JSON.parse(String(init?.body)) as { writes: Array<{ transform: { document: string; fieldTransforms: Array<{ fieldPath: string; increment: { integerValue?: string; doubleValue?: number } }> } }> };
      for (const w of body.writes) {
        const path = w.transform.document.split("/documents/")[1] as string;
        const cur = docs.get(path) ?? {};
        for (const t of w.transform.fieldTransforms) cur[t.fieldPath] = Number(cur[t.fieldPath] ?? 0) + Number(t.increment.integerValue ?? t.increment.doubleValue ?? 0);
        docs.set(path, cur);
      }
      return new Response("{}", { status: 200 });
    }
    const path = u.pathname.slice(prefix.length);
    if (init?.method === "PATCH") {
      if (u.searchParams.get("currentDocument.exists") === "true" && !docs.has(path)) return new Response("{}", { status: 404 });
      const body = JSON.parse(String(init.body)) as { fields: Record<string, Record<string, unknown>> };
      const cur = docs.get(path) ?? {};
      for (const [k, v] of Object.entries(body.fields)) cur[k] = decode(v);
      docs.set(path, cur);
      return new Response("{}", { status: 200 });
    }
    const doc = docs.get(path);
    if (!doc) return new Response("{}", { status: 404 });
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) fields[k] = encode(v);
    return new Response(JSON.stringify({ name: path, fields }), { status: 200 });
  };
  return { docs, fetchImpl };
}
```

- [ ] **Step 2: Failing tests for the client (mocked fetch)**

`apps/api/test/firestore.test.ts`:
```ts
import { FirestoreClient } from "../src/firestore/client";
import { fromFirestoreDocument, toFirestoreValue } from "../src/firestore/values";

test("value codec round-trips strings, numbers, booleans, nested maps, arrays, null", () => {
  const v = { a: "x", n: 3, f: 1.5, b: true, z: null, m: { k: [1, "two", null] } };
  const enc = toFirestoreValue(v) as { mapValue: { fields: Record<string, never> } };
  expect(fromFirestoreDocument({ fields: enc.mapValue.fields })).toEqual(v);
});

function recorder(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { calls, client: new FirestoreClient({ projectId: "p", tokenProvider: async () => "TOKEN", fetchImpl }) };
}

test("getDocument returns null on 404 and decoded fields on 200, with bearer token", async () => {
  const { calls, client } = recorder([{ status: 404, body: {} }, { status: 200, body: { name: "x", fields: { tier: { stringValue: "free" } } } }]);
  expect(await client.getDocument("users/u1")).toBeNull();
  expect(await client.getDocument("users/u1")).toEqual({ tier: "free" });
  expect(calls[0]?.url).toBe("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users/u1");
  expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer TOKEN");
});

test("patchDocument sends updateMask and precondition", async () => {
  const { calls, client } = recorder([{ status: 200, body: {} }]);
  await client.patchDocument("users/u1", { lastActiveDate: "2026-09-20" }, { updateMask: ["lastActiveDate"], mustExist: true });
  const url = new URL(calls[0]?.url ?? "");
  expect(calls[0]?.init?.method).toBe("PATCH");
  expect(url.searchParams.getAll("updateMask.fieldPaths")).toEqual(["lastActiveDate"]);
  expect(url.searchParams.get("currentDocument.exists")).toBe("true");
});

test("incrementFields uses :commit with integer/double transforms", async () => {
  const { calls, client } = recorder([{ status: 200, body: {} }]);
  await client.incrementFields("metrics/global", { totalUsers: 1, ratio: 0.5 });
  expect(calls[0]?.url).toBe("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:commit");
  const body = JSON.parse(String(calls[0]?.init?.body));
  expect(body.writes[0].transform.document).toBe("projects/p/databases/(default)/documents/metrics/global");
  expect(body.writes[0].transform.fieldTransforms).toEqual([
    { fieldPath: "totalUsers", increment: { integerValue: "1" } },
    { fieldPath: "ratio", increment: { doubleValue: 0.5 } },
  ]);
});

test("non-2xx (other than 404 on GET) throws with the status", async () => {
  const { client } = recorder([{ status: 403, body: { error: { message: "denied" } } }]);
  await expect(client.getDocument("users/u1")).rejects.toThrow(/403/);
});
```

- [ ] **Step 3: Failing test for `/ping` behaviour**

`apps/api/test/ping.test.ts`:
```ts
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { fakeFirestore } from "./helpers/fakeFirestore";
import { TEST_SA_JSON } from "./helpers/testPem";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");
const withSa = { ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON };

test("first ping creates the user and bumps totals; second ping the same day changes nothing", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl: fs.fetchImpl });
  const token = await jwks.sign({ sub: "u1" });

  const first = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, withSa);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, uid: "u1", firstSeen: true });
  expect(fs.docs.get("users/u1")).toMatchObject({ tier: "free", tierSource: "none", freeGenerationUsed: false, plusRequested: false, lastActiveDate: "2026-09-20" });
  expect(fs.docs.get("metrics/global")).toEqual({ totalUsers: 1 });
  expect(fs.docs.get("metricsDaily/2026-09-20")).toEqual({ newUsers: 1, activeUsers: 1 });

  const second = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, withSa);
  expect(await second.json()).toMatchObject({ firstSeen: false });
  expect(fs.docs.get("metricsDaily/2026-09-20")).toEqual({ newUsers: 1, activeUsers: 1 });
});

test("a ping on a new day counts one more active user", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  fs.docs.set("users/u2", { tier: "free", lastActiveDate: "2026-09-19" });
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl: fs.fetchImpl });
  const token = await jwks.sign({ sub: "u2" });
  const res = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, withSa);
  expect(await res.json()).toMatchObject({ firstSeen: false });
  expect(fs.docs.get("users/u2")).toMatchObject({ lastActiveDate: "2026-09-20" });
  expect(fs.docs.get("metricsDaily/2026-09-20")).toEqual({ activeUsers: 1 });
});

test("service-account token is cached in KV", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl: fs.fetchImpl });
  await app.request("/ping", { headers: { authorization: `Bearer ${await jwks.sign({ sub: "u3" })}` } }, withSa);
  expect(await env.CONFIG_KV.get("sa_access_token")).toBe("T");
});

test("FIRESTORE_EMULATOR_HOST routes REST calls to the emulator over http with the 'owner' token and no service account", async () => {
  const jwks = await makeTestJwks();
  const seen: { url: string; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response("{}", { status: url.includes(":commit") || init?.method === "PATCH" ? 200 : 404 });
  };
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const res = await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${await jwks.sign({ sub: "u4" })}` } },
    { ...env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_SERVICE_ACCOUNT: "" }, // no SA needed in emulator mode
  );
  expect(res.status).toBe(200);
  expect(seen[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:8080\/v1\/projects\/test-project\/databases\/\(default\)\/documents\/users\/u4$/);
  expect(seen.every((s) => s.auth === "Bearer owner")).toBe(true);
  expect(seen.some((s) => s.url.startsWith("https://oauth2.googleapis.com"))).toBe(false);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @wayfare/api test`
Expected: FAIL — modules missing / `firstSeen` is false.

- [ ] **Step 5: Implement service-account token minting**

`apps/api/src/firestore/serviceAccount.ts`:
```ts
import type { FetchLike } from "@wayfare/providers";
import { SignJWT, importPKCS8 } from "jose";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const KV_KEY = "sa_access_token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

export function parseServiceAccount(raw: string): ServiceAccount {
  const obj = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!obj.client_email || !obj.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key");
  return { client_email: obj.client_email, private_key: obj.private_key };
}

/** Mints (and KV-caches) an OAuth2 access token for the Firestore REST API. One KV write per ~55 minutes. */
export async function getAccessToken(sa: ServiceAccount, kv: KVNamespace, fetchImpl: FetchLike, now: Date): Promise<string> {
  const cached = await kv.get(KV_KEY);
  if (cached) return cached;
  const key = await importPKCS8(sa.private_key, "RS256");
  const iat = Math.floor(now.getTime() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new Error(`Service account token exchange failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await kv.put(KV_KEY, json.access_token, { expirationTtl: Math.min(3300, Math.max(60, json.expires_in - 300)) });
  return json.access_token;
}
```

- [ ] **Step 6: Implement the value codec and client**

`apps/api/src/firestore/values.ts`:
```ts
export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export function toFirestoreValue(v: unknown): FirestoreValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value: ${typeof v}`);
}

export function fromFirestoreValue(v: FirestoreValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromFirestoreValue);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = fromFirestoreValue(val);
  return out;
}

export function fromFirestoreDocument(doc: { fields?: Record<string, FirestoreValue> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) out[k] = fromFirestoreValue(v);
  return out;
}
```

`apps/api/src/firestore/client.ts`:
```ts
import type { FetchLike } from "@wayfare/providers";
import { type FirestoreValue, fromFirestoreDocument, toFirestoreValue } from "./values";

export interface FirestoreClientOptions {
  projectId: string;
  tokenProvider: () => Promise<string>;
  fetchImpl: FetchLike;
  /** Defaults to https://firestore.googleapis.com; dev.bat points it at the emulator (http://127.0.0.1:8080). */
  host?: string;
}

export class FirestoreClient {
  private readonly docRoot: string;
  private readonly apiRoot: string;
  private readonly base: string;

  constructor(private readonly opts: FirestoreClientOptions) {
    this.docRoot = `projects/${opts.projectId}/databases/(default)/documents`;
    this.apiRoot = `${opts.host ?? "https://firestore.googleapis.com"}/v1`;
    this.base = `${this.apiRoot}/${this.docRoot}`;
  }

  private async call(url: string, init: RequestInit = {}, allow404 = false): Promise<Response> {
    const token = await this.opts.tokenProvider();
    const res = await this.opts.fetchImpl(url, {
      ...init,
      headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!res.ok && !(allow404 && res.status === 404)) throw new Error(`Firestore HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async getDocument(path: string): Promise<Record<string, unknown> | null> {
    const res = await this.call(`${this.base}/${path}`, {}, true);
    if (res.status === 404) return null;
    return fromFirestoreDocument((await res.json()) as { fields?: Record<string, FirestoreValue> });
  }

  /** PATCH with updateMask = upsert (creates the doc if missing unless mustExist). */
  async patchDocument(path: string, fields: Record<string, unknown>, opts: { updateMask?: string[]; mustExist?: boolean; mustNotExist?: boolean } = {}): Promise<void> {
    const url = new URL(`${this.base}/${path}`);
    for (const f of opts.updateMask ?? Object.keys(fields)) url.searchParams.append("updateMask.fieldPaths", f);
    if (opts.mustExist) url.searchParams.set("currentDocument.exists", "true");
    if (opts.mustNotExist) url.searchParams.set("currentDocument.exists", "false");
    const encoded = toFirestoreValue(fields) as { mapValue: { fields: Record<string, FirestoreValue> } };
    await this.call(url.toString(), { method: "PATCH", body: JSON.stringify({ fields: encoded.mapValue.fields }) });
  }

  /** Atomic numeric increments via :commit; creates the document if it does not exist. */
  async incrementFields(path: string, increments: Record<string, number>): Promise<void> {
    const fieldTransforms = Object.entries(increments).map(([fieldPath, n]) => ({
      fieldPath,
      increment: Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n },
    }));
    await this.call(`${this.apiRoot}/${this.docRoot}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes: [{ transform: { document: `${this.docRoot}/${path}`, fieldTransforms } }] }),
    });
  }
}
```
(Update the `incrementFields` test expectation in `firestore.test.ts` accordingly — it already asserts the full `https://firestore.googleapis.com/v1/...:commit` URL, which is unchanged for the default host.)

- [ ] **Step 7: Implement the `/ping` route with Firestore**

`apps/api/src/routes/ping.ts`:
```ts
import type { PingResponse } from "@wayfare/domain";
import type { FetchLike } from "@wayfare/providers";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { firebaseAuth } from "../auth/middleware";
import type { Env } from "../env";
import { FirestoreClient } from "../firestore/client";
import { getAccessToken, parseServiceAccount } from "../firestore/serviceAccount";

export function firestoreFor(env: Env, fetchImpl: FetchLike, now: () => Date): FirestoreClient {
  // Emulator mode (dev.bat only): plain http to the emulator, fixed "owner" bearer, no service account.
  if (env.FIRESTORE_EMULATOR_HOST) {
    return new FirestoreClient({ projectId: env.FIREBASE_PROJECT_ID, fetchImpl, host: `http://${env.FIRESTORE_EMULATOR_HOST}`, tokenProvider: async () => "owner" });
  }
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  return new FirestoreClient({
    projectId: env.FIREBASE_PROJECT_ID,
    fetchImpl,
    tokenProvider: () => getAccessToken(sa, env.CONFIG_KV, fetchImpl, now()),
  });
}

const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export const pingRoutes = new Hono<AppEnv>();

pingRoutes.get("/", firebaseAuth, async (c) => {
  const { fetchImpl, now } = c.get("deps");
  const user = c.get("user");
  const db = firestoreFor(c.env, fetchImpl, now);
  const today = utcDay(now());
  const userPath = `users/${user.uid}`;
  const existing = await db.getDocument(userPath);
  let firstSeen = false;
  if (!existing) {
    firstSeen = true;
    await db.patchDocument(userPath, {
      createdAt: now().toISOString(),
      lastActiveDate: today,
      tier: "free",
      tierSource: "none",
      freeGenerationUsed: false,
      plusRequested: false,
      locale: "en",
    });
    await db.incrementFields("metrics/global", { totalUsers: 1 });
    await db.incrementFields(`metricsDaily/${today}`, { newUsers: 1, activeUsers: 1 });
  } else if (existing.lastActiveDate !== today) {
    await db.patchDocument(userPath, { lastActiveDate: today }, { updateMask: ["lastActiveDate"], mustExist: true });
    await db.incrementFields(`metricsDaily/${today}`, { activeUsers: 1 });
  }
  const body: PingResponse = { ok: true, uid: user.uid, serverTime: now().toISOString(), firstSeen };
  return c.json(body);
});
```

In `app.ts`: delete the inline `/ping` handler and its imports; add `import { pingRoutes } from "./routes/ping";` and `app.route("/ping", pingRoutes);`.

Update `apps/api/test/auth.test.ts`: create the app with `fetchImpl: fakeFirestore().fetchImpl` and pass `{ ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON }` as the env argument in every `app.request` call, so the valid-token test still returns 200.

- [ ] **Step 8: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/api test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): Firestore REST client with service-account auth; /ping creates users and touches metrics"
```

---

### Task 10: `FirestoreQuotaStore`, router factory and admin `POST /admin/llm/ping`

**Files:**
- Create: `apps/api/src/firestore/quotaStore.ts`, `apps/api/src/llm/routerFactory.ts`
- Create: `apps/api/test/quotaStore.test.ts`, `apps/api/test/llmPing.test.ts`
- Modify: `apps/api/src/routes/admin.ts`

**Interfaces:**
- Produces:
  ```ts
  class FirestoreQuotaStore implements QuotaStore {
    constructor(opts: { db: FirestoreClient; kv: KVNamespace })
    // isExhausted: KV `exhausted:${id}` holds untilIso; expired flags ignored
    // markExhausted: KV put with expirationTtl to the reset instant (one write per exhaustion)
    // recordCall: db.incrementFields(`usageDaily/${provider}_${providerDayKey(provider, now)}`, { [`${entry.id}.${outcome}`]: 1, total: 1 })
  }
  function createRouter(env: Env, deps: AppVariables["deps"], db: FirestoreClient): ModelRouter   // Gemini + OpenRouter providers from env, DEFAULT_REGISTRY, FirestoreQuotaStore
  ```
  Route: `POST /admin/llm/ping` (admin, fresh auth) → `router.run("best", …)` → `LlmPingResponse`; a chain-wide `LlmError` → `503 upstream_exhausted`.

- [ ] **Step 1: Failing tests for the quota store**

`apps/api/test/quotaStore.test.ts`:
```ts
import { env } from "cloudflare:test";
import { DEFAULT_REGISTRY } from "@wayfare/domain";
import { FirestoreClient } from "../src/firestore/client";
import { FirestoreQuotaStore } from "../src/firestore/quotaStore";

const NOW = new Date("2026-09-20T12:00:00Z");

function recordingDb() {
  const commits: { path: string; inc: Record<string, number> }[] = [];
  const db = new FirestoreClient({ projectId: "p", tokenProvider: async () => "T", fetchImpl: async () => new Response("{}", { status: 200 }) });
  db.incrementFields = async (path, inc) => {
    commits.push({ path, inc });
  };
  return { db, commits };
}

test("exhaustion flag lives in KV and is ignored once past its instant", async () => {
  const store = new FirestoreQuotaStore({ db: recordingDb().db, kv: env.CONFIG_KV });
  expect(await store.isExhausted("google:gemini-3.8-flash", NOW)).toBe(false);
  await store.markExhausted("google:gemini-3.8-flash", "2026-09-21T07:00:00.000Z");
  expect(await store.isExhausted("google:gemini-3.8-flash", NOW)).toBe(true);
  expect(await store.isExhausted("google:gemini-3.8-flash", new Date("2026-09-21T08:00:00Z"))).toBe(false);
});

test("recordCall increments the per-model outcome and total in the provider-day document", async () => {
  const { db, commits } = recordingDb();
  const store = new FirestoreQuotaStore({ db, kv: env.CONFIG_KV });
  const entry = DEFAULT_REGISTRY.models.find((m) => m.id === "google:gemini-3.8-flash");
  if (!entry) throw new Error("registry changed");
  await store.recordCall(entry, "ok", NOW);
  expect(commits[0]).toEqual({ path: "usageDaily/google_2026-09-20", inc: { "google:gemini-3.8-flash.ok": 1, total: 1 } });
});
```

- [ ] **Step 2: Implement the store and router factory**

`apps/api/src/firestore/quotaStore.ts`:
```ts
import type { ModelEntry } from "@wayfare/domain";
import { type LlmErrorKind, type QuotaStore, providerDayKey } from "@wayfare/providers";
import type { FirestoreClient } from "./client";

/** Exhaustion flags in KV (rare writes); per-call counters in Firestore (spec §2.3 KV write ceiling). */
export class FirestoreQuotaStore implements QuotaStore {
  constructor(private readonly opts: { db: FirestoreClient; kv: KVNamespace }) {}

  async isExhausted(modelEntryId: string, now: Date): Promise<boolean> {
    const until = await this.opts.kv.get(`exhausted:${modelEntryId}`);
    return until !== null && new Date(until).getTime() > now.getTime();
  }

  async markExhausted(modelEntryId: string, untilIso: string): Promise<void> {
    const ttl = Math.max(60, Math.floor((new Date(untilIso).getTime() - Date.now()) / 1000));
    await this.opts.kv.put(`exhausted:${modelEntryId}`, untilIso, { expirationTtl: ttl });
  }

  async recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void> {
    const day = providerDayKey(entry.provider, now);
    await this.opts.db.incrementFields(`usageDaily/${entry.provider}_${day}`, { [`${entry.id}.${outcome}`]: 1, total: 1 });
  }
}
```

`apps/api/src/llm/routerFactory.ts`:
```ts
import { DEFAULT_REGISTRY } from "@wayfare/domain";
import { GeminiProvider, ModelRouter, OpenRouterProvider } from "@wayfare/providers";
import type { AppVariables } from "../app";
import type { Env } from "../env";
import type { FirestoreClient } from "../firestore/client";
import { FirestoreQuotaStore } from "../firestore/quotaStore";

export function createRouter(env: Env, deps: AppVariables["deps"], db: FirestoreClient): ModelRouter {
  return new ModelRouter({
    registry: DEFAULT_REGISTRY,
    providers: {
      google: new GeminiProvider(env.GEMINI_API_KEY, deps.fetchImpl),
      openrouter: new OpenRouterProvider(env.OPENROUTER_API_KEY, deps.fetchImpl, env.ALLOWED_ORIGIN),
    },
    quota: new FirestoreQuotaStore({ db, kv: env.CONFIG_KV }),
    now: deps.now,
  });
}
```

- [ ] **Step 3: Failing test for the admin LLM ping**

`apps/api/test/llmPing.test.ts`:
```ts
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { fakeFirestore } from "./helpers/fakeFirestore";
import { TEST_SA_JSON } from "./helpers/testPem";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");

test("admin llm ping falls back from an exhausted Gemini model to the next and reports attempts", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  let geminiCalls = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      if (url.includes("gemini-3.8-flash")) return new Response(JSON.stringify({ error: { message: "limit 20 per day" } }), { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
    }
    return fs.fetchImpl(url, init);
  };
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const token = await jwks.sign({ sub: "admin-uid-1", auth_time: Math.floor(NOW.getTime() / 1000) - 30 });
  const res = await app.request("/admin/llm/ping", { method: "POST", headers: { authorization: `Bearer ${token}` } }, { ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON });
  expect(res.status).toBe(200);
  const body = await res.json<{ modelUsed: string; attempts: { modelId: string; outcome: string }[] }>();
  expect(body.modelUsed).toBe("gemini-3.7-flash");
  expect(body.attempts.map((a) => a.outcome)).toEqual(["daily_quota", "ok"]);
  expect(geminiCalls).toBe(2);
  expect(fs.docs.get("usageDaily/google_2026-09-20")).toMatchObject({ total: 2 });
  expect(await env.CONFIG_KV.get("exhausted:google:gemini-3.8-flash")).toBe("2026-09-21T07:00:00.000Z");
});

test("when every model fails the route answers 503 upstream_exhausted", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  const fetchImpl = async (url: string, init?: RequestInit) =>
    url.includes("generativelanguage") || url.includes("openrouter.ai")
      ? new Response(JSON.stringify({ error: { message: "per day" } }), { status: 429 })
      : fs.fetchImpl(url, init);
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const token = await jwks.sign({ sub: "admin-uid-1", auth_time: Math.floor(NOW.getTime() / 1000) - 30 });
  const res = await app.request("/admin/llm/ping", { method: "POST", headers: { authorization: `Bearer ${token}` } }, { ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON });
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: "upstream_exhausted" });
});
```

- [ ] **Step 4: Implement the route**

Append to `apps/api/src/routes/admin.ts`:
```ts
import type { LlmPingResponse } from "@wayfare/domain";
import { LlmError } from "@wayfare/providers";
import { apiError } from "../http/errors";
import { createRouter } from "../llm/routerFactory";
import { firestoreFor } from "./ping";

adminRoutes.post("/llm/ping", async (c) => {
  const deps = c.get("deps");
  const db = firestoreFor(c.env, deps.fetchImpl, deps.now);
  const router = createRouter(c.env, deps, db);
  try {
    const r = await router.run("best", {
      prompt: 'Return exactly this JSON: {"ok":true}',
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      maxOutputTokens: 32,
    });
    const body: LlmPingResponse = {
      ok: true,
      modelUsed: r.modelId,
      provider: r.provider,
      attempts: r.attempts.map((a) => ({ modelId: a.modelId, outcome: a.outcome })),
      text: r.text,
    };
    return c.json(body);
  } catch (e) {
    if (e instanceof LlmError) return apiError(c, 503, "upstream_exhausted", e.message);
    throw e;
  }
});
```

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/api test && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): Firestore-backed quota store, router factory and admin POST /admin/llm/ping"
```

---

### Task 11: Firestore security rules with emulator tests (`@wayfare/firebase-rules`)

**Files:**
- Create: `infra/firebase/package.json`, `infra/firebase/tsconfig.json`, `infra/firebase/vitest.config.ts`, `infra/firebase/firebase.json`, `infra/firebase/.firebaserc`, `infra/firebase/firestore.rules`, `infra/firebase/firestore.indexes.json`, `infra/firebase/test/rules.test.ts`

**Interfaces:**
- Produces: rules for Phase 0 collections (spec §6/§8). Clients: read own `users/{uid}` (+ `usage/*`); read `config/*` when signed in; the **admin UID** (hardcoded in `isAdmin()`) reads `metrics/*`, `metricsDaily/*`, `usageDaily/*`, `llmModels/*`, `configVersions/*`, `auditLog/*`. All client writes denied. `firebase.json` also configures Hosting (Task 13) and the emulator.

- [ ] **Step 1: Package and Firebase config**

`infra/firebase/package.json`:
```json
{
  "name": "@wayfare/firebase-rules",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "firebase emulators:exec --only firestore --project demo-wayfare \"vitest run\"",
    "build": "echo skip"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^4.0.0",
    "firebase": "^12.0.0",
    "firebase-tools": "^14.15.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`infra/firebase/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["vitest/globals", "node"] }, "include": ["test"] }
```
(add `"@types/node": "^22.0.0"` to devDependencies.)

`infra/firebase/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: true, include: ["test/**/*.test.ts"], testTimeout: 20000, hookTimeout: 30000 } });
```

`infra/firebase/.firebaserc`: `{ "projects": { "default": "<project>" } }`

`infra/firebase/firestore.indexes.json`: `{ "indexes": [], "fieldOverrides": [] }`

`infra/firebase/firebase.json` (CSP placeholders `<cf-subdomain>` and `<project>` are filled in Task 13):
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "hosting": {
    "public": "../../apps/web/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
          { "key": "Permissions-Policy", "value": "geolocation=(), camera=(), microphone=()" },
          {
            "key": "Content-Security-Policy",
            "value": "default-src 'self'; script-src 'self' https://apis.google.com https://www.gstatic.com; connect-src 'self' https://wayfare-api.<cf-subdomain>.workers.dev https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com; img-src 'self' data: https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src https://<project>.firebaseapp.com https://accounts.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
          }
        ]
      },
      { "source": "**/*.html", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
      { "source": "/", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
      { "source": "/assets/**", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
    ]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

Why users always get the newest build after `prod.bat`: Vite emits every JS/CSS asset under `/assets/` with a content hash in the file name (immutable, cached for a year), while `index.html` — the only file that references those hashes — is served with `Cache-Control: no-cache, no-store, must-revalidate`, so every page load fetches the current `index.html` and therefore the current asset set. The SPA rewrite serves `index.html` for every route, so the `/` and `**/*.html` header rules cover all entry points. No manual cache clearing is ever needed.

- [ ] **Step 2: Failing rules tests**

`infra/firebase/test/rules.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { type RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

/** Must equal the placeholder in firestore.rules. It can never collide with a real Firebase UID. */
const ADMIN_UID = "TEST_ADMIN_UID";
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-wayfare",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { tier: "free" });
    await setDoc(doc(db, "users/bob"), { tier: "plus" });
    await setDoc(doc(db, "config/current"), { version: 1 });
    await setDoc(doc(db, "metrics/global"), { totalUsers: 2 });
    await setDoc(doc(db, "usageDaily/google_2026-09-20"), { total: 5 });
  });
});
afterAll(async () => env.cleanup());

const asUser = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("anonymous reads and writes are denied everywhere", async () => {
  await assertFails(getDoc(doc(anon(), "users/alice")));
  await assertFails(getDoc(doc(anon(), "config/current")));
  await assertFails(setDoc(doc(anon(), "users/x"), { tier: "plus" }));
});

test("a user reads their own document but not another user's", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "users/alice")));
  await assertFails(getDoc(doc(asUser("alice"), "users/bob")));
});

test("clients cannot write users, config or metrics — not even the admin", async () => {
  await assertFails(setDoc(doc(asUser("alice"), "users/alice"), { tier: "plus" }));
  await assertFails(setDoc(doc(asUser("alice"), "config/current"), { version: 2 }));
  await assertFails(setDoc(doc(asUser(ADMIN_UID), "metrics/global"), { totalUsers: 0 }));
});

test("signed-in users can read config/current", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "config/current")));
});

test("only the admin uid reads metrics and usage", async () => {
  await assertFails(getDoc(doc(asUser("alice"), "metrics/global")));
  await assertFails(getDoc(doc(asUser("alice"), "usageDaily/google_2026-09-20")));
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "metrics/global")));
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "usageDaily/google_2026-09-20")));
});

test("unverified email is treated as anonymous", async () => {
  const db = env.authenticatedContext("alice", { email_verified: false }).firestore();
  await assertFails(getDoc(doc(db, "users/alice")));
});

test("unknown collections are denied", async () => {
  await assertFails(getDoc(doc(asUser(ADMIN_UID), "plans/anything")));
});

const ALL_COLLECTIONS = ["users/alice", "users/alice/usage/2026-09", "plans/p1", "plans/p1/versions/v1", "config/current", "configVersions/1", "metrics/global", "metricsDaily/2026-09-20", "usageDaily/google_2026-09-20", "llmModels/m", "auditLog/a", "places/x", "shares/s"];

test.each(ALL_COLLECTIONS)("anonymous cannot read or write %s", async (path) => {
  await assertFails(getDoc(doc(anon(), path)));
  await assertFails(setDoc(doc(anon(), path), { x: 1 }));
});

test("a user cannot read or write another user's users/* or plans/*", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "plans/bobs-plan"), { ownerUid: "bob" });
    await setDoc(doc(ctx.firestore(), "users/bob/usage/2026-09"), { plansCreated: 1 });
  });
  await assertFails(getDoc(doc(asUser("alice"), "users/bob/usage/2026-09")));
  await assertFails(setDoc(doc(asUser("alice"), "users/bob"), { tier: "free" }));
  await assertFails(getDoc(doc(asUser("alice"), "plans/bobs-plan")));
  await assertFails(setDoc(doc(asUser("alice"), "plans/bobs-plan"), { ownerUid: "alice" }));
});

test.each(["config/current", "configVersions/1", "llmModels/m", "usageDaily/google_2026-09-20", "metrics/global", "metricsDaily/2026-09-20", "auditLog/a"])(
  "client writes to %s are denied even for the admin UID",
  async (path) => {
    await assertFails(setDoc(doc(asUser(ADMIN_UID), path), { hacked: true }));
    await assertFails(setDoc(doc(asUser("alice"), path), { hacked: true }));
  },
);

test("admin UID can read config/current (like any signed-in user) and admin-only telemetry", async () => {
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "config/current")));
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "metrics/global")));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @wayfare/firebase-rules test`
Expected: the emulator starts (Java required); tests FAIL because `firestore.rules` is missing.

- [ ] **Step 4: Write the rules**

`infra/firebase/firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Spec §8 lock #2: admin UIDs are hardcoded here and deployed with the rules.
    // Task 13 appends the owner's real UID; TEST_ADMIN_UID stays for emulator tests.
    function isAdmin() {
      return signedIn() && request.auth.uid in ['TEST_ADMIN_UID'];
    }

    function signedIn() {
      return request.auth != null && request.auth.token.email_verified == true;
    }

    function isOwner(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    // Users: owner reads; no client writes (the Worker uses a service account).
    match /users/{uid} {
      allow read: if isOwner(uid);
      allow write: if false;
      match /usage/{month} {
        allow read: if isOwner(uid);
        allow write: if false;
      }
    }

    // App configuration (magic numbers, tier limits): any signed-in user reads.
    match /config/{docId} {
      allow read: if signedIn();
      allow write: if false;
    }

    // Admin-only telemetry and registry.
    match /metrics/{docId}        { allow read: if isAdmin(); allow write: if false; }
    match /metricsDaily/{docId}   { allow read: if isAdmin(); allow write: if false; }
    match /usageDaily/{docId}     { allow read: if isAdmin(); allow write: if false; }
    match /llmModels/{docId}      { allow read: if isAdmin(); allow write: if false; }
    match /configVersions/{docId} { allow read: if isAdmin(); allow write: if false; }
    match /auditLog/{docId}       { allow read: if isAdmin(); allow write: if false; }

    // Everything else (plans, versions, places, packs, shares, ...) arrives in later phases.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Run the rules tests**

Run: `pnpm --filter @wayfare/firebase-rules test`
Expected: all tests PASS (7 named tests + the parameterised anonymous/collection and admin-write sweeps).

- [ ] **Step 6: Deploy the rules once (manual)**

Run: `cd infra/firebase && pnpm dlx firebase-tools@14 login` then `pnpm dlx firebase-tools@14 deploy --only firestore:rules --project <project>`
Expected: "Deploy complete".

- [ ] **Step 7: Commit**

```bash
git add infra/firebase
git commit -m "feat(infra): Firestore security rules with emulator tests; hosting config with security headers"
```

---

### Task 12: Web app — Vite + React + TanStack Router + Tailwind + i18n + Google sign-in + `/ping`

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/.env.example`, `apps/web/src/index.css`, `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/main.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`, `apps/web/src/routes/admin.tsx`
- Create: `apps/web/src/lib/firebase.ts`, `apps/web/src/lib/emulators.ts`, `apps/web/src/lib/useAuth.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/test/emulators.test.ts`, `tools/test/bundleSecrets.test.ts`
- Create: `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/he.json`, `apps/web/src/components/LanguageSelect.tsx`
- Create: `apps/web/src/test/setup.ts`, `apps/web/src/test/i18n.test.ts`, `apps/web/src/test/api.test.ts`, `apps/web/src/test/LanguageSelect.test.tsx`
- Generated by shadcn: `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/button.tsx`

**Interfaces:**
- Produces:
  ```ts
  // lib/api.ts
  class ApiClientError extends Error { readonly code: ApiErrorCode; readonly status: number }
  function apiFetch<T>(path: string, schema: ZodType<T>, init?: RequestInit & { token?: string | null }): Promise<T>
  // lib/firebase.ts
  const auth: Auth; function signInWithGoogle(): Promise<void>   // popup on desktop, redirect on mobile
  // lib/useAuth.ts
  function useAuth(): { user: User | null; loading: boolean; getIdToken(): Promise<string | null> }
  // i18n/index.ts
  function initI18n(initialCode?: string): i18n; function applyLocale(code: string): void   // sets i18next language + <html lang dir>; persists to localStorage "wayfare.locale"
  ```

- [ ] **Step 1: Package, Vite, Tailwind, shadcn**

`apps/web/package.json`:
```json
{
  "name": "@wayfare/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.85.0",
    "@tanstack/react-router": "^1.130.0",
    "@wayfare/domain": "workspace:*",
    "firebase": "^12.0.0",
    "i18next": "^25.0.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-i18next": "^15.6.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "@tanstack/router-plugin": "^1.130.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^26.0.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.9.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/web/vite.config.ts`:
```ts
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test/setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_API_URL: string;
  /** "1" → connect the Firebase SDK to local emulators (set by dev.bat). */
  readonly VITE_USE_EMULATORS?: string;
}
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wayfare</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/index.css`: `@import "tailwindcss";`

`apps/web/.env.example`:
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project>
VITE_FIREBASE_APP_ID=
VITE_API_URL=http://127.0.0.1:8787
VITE_USE_EMULATORS=0
```

Initialise shadcn (creates `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`): `cd apps/web && pnpm dlx shadcn@latest init -d && pnpm dlx shadcn@latest add button`. If the generator asks for a CSS file, point it at `src/index.css`.

- [ ] **Step 2: Failing tests — i18n and API client**

`apps/web/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

`apps/web/src/test/i18n.test.ts`:
```ts
import { applyLocale, initI18n } from "../i18n";

test("applyLocale sets html lang and dir from the registry", () => {
  initI18n("en");
  applyLocale("he");
  expect(document.documentElement.getAttribute("lang")).toBe("he");
  expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  applyLocale("en");
  expect(document.documentElement.getAttribute("dir")).toBe("ltr");
});

test("unknown locale falls back to the default (en, ltr)", () => {
  initI18n("en");
  applyLocale("xx");
  expect(document.documentElement.getAttribute("lang")).toBe("en");
  expect(document.documentElement.getAttribute("dir")).toBe("ltr");
});
```

`apps/web/src/test/api.test.ts`:
```ts
import { z } from "zod";
import { ApiClientError, apiFetch } from "../lib/api";

const schema = z.object({ ok: z.literal(true), uid: z.string() });

test("attaches bearer token and parses with the schema", async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ ok: true, uid: "u" }), { status: 200 });
  });
  const r = await apiFetch("/ping", schema, { token: "T" });
  expect(r.uid).toBe("u");
  expect(new Headers(calls[0]?.headers).get("authorization")).toBe("Bearer T");
});

test("non-2xx becomes ApiClientError with the server code", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "unauthorized", message: "Missing" }), { status: 401 }));
  await expect(apiFetch("/ping", schema)).rejects.toMatchObject({ code: "unauthorized", status: 401 } satisfies Partial<ApiClientError>);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm install && pnpm --filter @wayfare/web test`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement i18n and the API client**

`apps/web/src/i18n/en.json`:
```json
{
  "app": { "name": "Wayfare", "tagline": "Plan a trip you'll actually take." },
  "auth": { "signIn": "Sign in with Google", "signOut": "Sign out", "signedInAs": "Signed in as {{email}}" },
  "ping": { "call": "Call protected /ping", "result": "Server time {{time}} · uid {{uid}}", "firstSeen": "Welcome — your account was just created." },
  "admin": { "title": "Admin", "ping": "Admin ping", "llmPing": "Test LLM chain", "forbidden": "This area is for the owner only." },
  "lang": { "label": "Language", "soon": "soon" }
}
```
`apps/web/src/i18n/he.json`:
```json
{
  "app": { "name": "Wayfare", "tagline": "מתכננים טיול שבאמת תעשו." },
  "auth": { "signIn": "התחברות עם Google", "signOut": "התנתקות", "signedInAs": "מחובר/ת בתור {{email}}" },
  "ping": { "call": "קריאה ל‑/ping מוגן", "result": "זמן שרת {{time}} · מזהה {{uid}}", "firstSeen": "ברוכים הבאים — החשבון נוצר כרגע." },
  "admin": { "title": "ניהול", "ping": "בדיקת מנהל", "llmPing": "בדיקת שרשרת המודלים", "forbidden": "האזור הזה מיועד לבעלים בלבד." },
  "lang": { "label": "שפה", "soon": "בקרוב" }
}
```

`apps/web/src/i18n/index.ts`:
```ts
import { DEFAULT_LOCALE, LOCALES, getLocale } from "@wayfare/domain";
import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import he from "./he.json";

const resources = { en: { translation: en }, he: { translation: he } } as const;
const STORAGE_KEY = "wayfare.locale";

export function initI18n(initialCode?: string): i18n {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  const code = getLocale(initialCode ?? stored ?? navigator.language.slice(0, 2)).code;
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: code,
      fallbackLng: DEFAULT_LOCALE.code,
      supportedLngs: LOCALES.map((l) => l.code),
      interpolation: { escapeValue: false },
      initImmediate: false,
    });
  }
  applyLocale(code);
  return i18next;
}

/** Direction comes from the registry row, never from the code (spec §2.5). */
export function applyLocale(code: string): void {
  const locale = getLocale(code);
  if (i18next.isInitialized && i18next.language !== locale.code) void i18next.changeLanguage(locale.code);
  document.documentElement.setAttribute("lang", locale.code);
  document.documentElement.setAttribute("dir", locale.dir);
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, locale.code);
}
```

`apps/web/src/lib/api.ts`:
```ts
import { type ApiErrorCode, ApiErrorSchema } from "@wayfare/domain";
import type { ZodType } from "zod";

export class ApiClientError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "";

export async function apiFetch<T>(path: string, schema: ZodType<T>, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (rest.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw new ApiClientError(parsed.success ? parsed.data.error : "internal", res.status, parsed.success ? parsed.data.message : `HTTP ${res.status}`);
  }
  return schema.parse(json);
}
```

- [ ] **Step 5: Firebase auth wiring**

First a failing test for emulator wiring — `apps/web/src/test/emulators.test.ts`:
```ts
import type { Auth } from "firebase/auth";

const connectAuthEmulator = vi.fn();
vi.mock("firebase/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("firebase/auth")>()), connectAuthEmulator }));

import { configureEmulators } from "../lib/emulators";

const fakeAuth = {} as Auth;

test("connects Auth to the emulator only when VITE_USE_EMULATORS === '1'", () => {
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "1" });
  expect(connectAuthEmulator).toHaveBeenCalledWith(fakeAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectAuthEmulator.mockClear();
  configureEmulators(fakeAuth, { VITE_USE_EMULATORS: "0" });
  configureEmulators(fakeAuth, {});
  expect(connectAuthEmulator).not.toHaveBeenCalled();
});
```
Run: `pnpm --filter @wayfare/web test` — Expected: FAIL (`../lib/emulators` missing).

`apps/web/src/lib/emulators.ts`:
```ts
import { type Auth, connectAuthEmulator } from "firebase/auth";

/**
 * dev.bat sets VITE_USE_EMULATORS=1 so the SDK talks to the local Auth emulator
 * (and, once the web app uses the Firestore SDK in later phases, connectFirestoreEmulator
 * is added here too). Production builds never define this variable.
 */
export function configureEmulators(auth: Auth, env: { VITE_USE_EMULATORS?: string }): void {
  if (env.VITE_USE_EMULATORS === "1") connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
```

`apps/web/src/lib/firebase.ts`:
```ts
import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, browserLocalPersistence, getAuth, setPersistence, signInWithPopup, signInWithRedirect } from "firebase/auth";
import { configureEmulators } from "./emulators";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
configureEmulators(auth, import.meta.env);
void setPersistence(auth, browserLocalPersistence);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

/** Popup on desktop, redirect on mobile (spec §5 auth gate). */
export async function signInWithGoogle(): Promise<void> {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) await signInWithRedirect(auth, provider);
  else await signInWithPopup(auth, provider);
}
```

`apps/web/src/lib/useAuth.ts`:
```ts
import { type User, onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "./firebase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      }),
    [],
  );
  return {
    user,
    loading,
    getIdToken: async (): Promise<string | null> => (auth.currentUser ? auth.currentUser.getIdToken() : null),
  };
}
```

- [ ] **Step 6: Language select component + test**

`apps/web/src/components/LanguageSelect.tsx`:
```tsx
import { LOCALES } from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { applyLocale } from "../i18n";

export function LanguageSelect() {
  const { i18n, t } = useTranslation();
  return (
    <select
      aria-label={t("lang.label")}
      className="rounded-md border bg-background px-2 py-1 text-sm"
      value={i18n.language}
      onChange={(e) => applyLocale(e.target.value)}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} disabled={!l.enabled}>
          {l.native}
          {l.enabled ? "" : ` · ${t("lang.soon")}`}
        </option>
      ))}
    </select>
  );
}
```

`apps/web/src/test/LanguageSelect.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSelect } from "../components/LanguageSelect";
import { initI18n } from "../i18n";

test("choosing Hebrew flips document direction to rtl", async () => {
  initI18n("en");
  render(<LanguageSelect />);
  await userEvent.selectOptions(screen.getByRole("combobox"), "he");
  expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  expect(screen.getByRole("combobox")).toHaveValue("he");
});
```

- [ ] **Step 7: Routes and app shell**

`apps/web/src/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initI18n } from "./i18n";
import { routeTree } from "./routeTree.gen";

initI18n();
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
const queryClient = new QueryClient();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/routes/__root.tsx`:
```tsx
import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "../components/LanguageSelect";
import { Button } from "../components/ui/button";
import { auth, signInWithGoogle } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";

export const Route = createRootRoute({ component: Shell });

function Shell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-3">
        <Link to="/" className="font-semibold">
          {t("app.name")}
        </Link>
        <div className="ms-auto flex items-center gap-3">
          <LanguageSelect />
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">{t("auth.signedInAs", { email: user.email })}</span>
              <Button variant="secondary" onClick={() => void signOut(auth)}>
                {t("auth.signOut")}
              </Button>
            </>
          ) : (
            <Button onClick={() => void signInWithGoogle()}>{t("auth.signIn")}</Button>
          )}
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

`apps/web/src/routes/index.tsx`:
```tsx
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PingResponseSchema } from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { t } = useTranslation();
  const { user, getIdToken } = useAuth();
  const ping = useMutation({ mutationFn: async () => apiFetch("/ping", PingResponseSchema, { token: await getIdToken() }) });
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("app.tagline")}</h1>
      <Button disabled={!user || ping.isPending} onClick={() => ping.mutate()}>
        {t("ping.call")}
      </Button>
      {ping.data && (
        <p className="text-sm">
          {t("ping.result", { time: ping.data.serverTime, uid: ping.data.uid })}
          {ping.data.firstSeen ? ` — ${t("ping.firstSeen")}` : ""}
        </p>
      )}
      {ping.error && <p className="text-sm text-red-600">{ping.error.message}</p>}
    </section>
  );
}
```

`apps/web/src/routes/admin.tsx`:
```tsx
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AdminPingResponseSchema, LlmPingResponseSchema } from "@wayfare/domain";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { ApiClientError, apiFetch } from "../lib/api";
import { useAuth } from "../lib/useAuth";

export const Route = createFileRoute("/admin")({ component: Admin });

function Admin() {
  const { t } = useTranslation();
  const { user, getIdToken } = useAuth();
  const ping = useQuery({
    queryKey: ["admin-ping", user?.uid],
    enabled: !!user,
    retry: false,
    queryFn: async () => apiFetch("/admin/ping", AdminPingResponseSchema, { token: await getIdToken() }),
  });
  const llm = useMutation({ mutationFn: async () => apiFetch("/admin/llm/ping", LlmPingResponseSchema, { method: "POST", token: await getIdToken() }) });
  if (ping.error instanceof ApiClientError && ping.error.code === "forbidden") return <p>{t("admin.forbidden")}</p>;
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
      {ping.data && (
        <p className="text-sm">
          {t("admin.ping")}: uid {ping.data.uid} · auth age {ping.data.authAgeSec}s
        </p>
      )}
      <Button onClick={() => llm.mutate()} disabled={!ping.data || llm.isPending}>
        {t("admin.llmPing")}
      </Button>
      {llm.data && <pre className="rounded bg-muted p-3 text-xs">{JSON.stringify(llm.data, null, 2)}</pre>}
      {llm.error && <p className="text-sm text-red-600">{llm.error.message}</p>}
    </section>
  );
}
```

- [ ] **Step 8: Run tests, typecheck, build**

Run: `pnpm --filter @wayfare/web test && pnpm --filter @wayfare/web build && pnpm lint && pnpm typecheck`
Expected: tests PASS; `dist/` produced; `src/routeTree.gen.ts` generated (commit it; Biome ignores it).

- [ ] **Step 8b: Bundle secret scan — the built app must contain no server secrets** (security)

`tools/test/bundleSecrets.test.ts` (runs against `apps/web/dist`; CI runs it right after the web build — Task 15):
```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "../../apps/web/dist");
const PATTERNS: [RegExp, string][] = [
  [/sk-or-v1-[0-9a-f]{64}/, "OpenRouter key"],
  [/tvly-[0-9A-Za-z_-]{20,}/, "Tavily key"],
  [/"private_key"/, "service-account private key field"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "private key block"],
  [/securetoken@system\.gserviceaccount\.com/, "server-side JWKS URL (Worker code leaked into the bundle)"],
  [/oauth2\.googleapis\.com\/token/, "service-account token exchange (Worker code leaked into the bundle)"],
];
// The Firebase web apiKey (AIza…) is public by design and expected in the bundle; it is NOT a secret and is not scanned.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".html") ? [p] : [];
  });
}

const skip = !existsSync(DIST);
(skip ? test.skip : test)("apps/web/dist contains no server secrets", () => {
  const files = walk(DIST);
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const [re, label] of PATTERNS) if (re.test(text)) hits.push(`${label} in ${f}`);
  }
  expect(hits).toEqual([]);
});
```
Add a root script `"scan:bundle": "pnpm --filter @wayfare/web build && pnpm --filter @wayfare/tools exec vitest run test/bundleSecrets.test.ts"`.
Run: `pnpm scan:bundle` — Expected: PASS. Negative check: temporarily add `const leak = "sk-or-v1-" + "a".repeat(64);` to `src/main.tsx`, rebuild, run — Expected: FAIL naming the file; revert.

- [ ] **Step 9: Local end-to-end smoke**

1. `copy apps\web\.env.example apps\web\.env` and fill from Task 0 Step 2.4 (keep `VITE_USE_EMULATORS=0` for this real-Google smoke).
2. In `apps/api/.dev.vars` set `ALLOWED_ORIGIN=http://localhost:5173`, paste the service-account JSON (single line) into `FIREBASE_SERVICE_ACCOUNT`, and the LLM keys.
3. Run `pnpm --filter @wayfare/api dev` and `pnpm --filter @wayfare/web dev`; open http://localhost:5173, sign in with Google, click **Call protected /ping**. (From Task 14 on, `dev.bat` replaces these two commands and runs against emulators.)
Expected: server time and your uid appear; Firestore console shows `users/<uid>`, `metrics/global`, `metricsDaily/<today>`. **Write down your uid** for Task 13.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): Vite React shell with TanStack Router, Tailwind, i18n registry, Google sign-in and /ping demo"
```

---

### Task 13: First deploy — Worker secrets, admin UID lock, Hosting, production smoke

**Files:**
- Modify: `apps/api/wrangler.toml` (`ALLOWED_ORIGIN`), `infra/firebase/firestore.rules` (`isAdmin()` UID), `infra/firebase/firebase.json` (CSP `connect-src`/`frame-src`)
- Create: `apps/web/.env.production.example` (the real `.env.production` stays git-ignored)

- [ ] **Step 1: Set Worker secrets and deploy**

```powershell
cd apps/api
pnpm dlx wrangler@4 secret put GEMINI_API_KEY
pnpm dlx wrangler@4 secret put OPENROUTER_API_KEY
pnpm dlx wrangler@4 secret put TAVILY_API_KEY
pnpm dlx wrangler@4 secret put ADMIN_UIDS                # your uid from Task 12 Step 9
pnpm dlx wrangler@4 secret put FIREBASE_SERVICE_ACCOUNT  # the whole JSON on one line
pnpm dlx wrangler@4 deploy
```
(From Task 14 on, `prod.bat` syncs these five secrets from the repo-root `.env` automatically whenever the API is deployed.)
Expected: a URL like `https://wayfare-api.<subdomain>.workers.dev`; `curl.exe https://wayfare-api.<subdomain>.workers.dev/health` → `{"ok":true,"service":"api"}`. Set the GitHub variable `VITE_API_URL` to this URL.

- [ ] **Step 2: Lock the admin UID in rules and deploy the rules**

Edit `infra/firebase/firestore.rules`: `request.auth.uid in ['TEST_ADMIN_UID']` → `request.auth.uid in ['TEST_ADMIN_UID', '<your-uid>']`.
Run: `cd infra/firebase && pnpm dlx firebase-tools@14 deploy --only firestore:rules --project <project>`

- [ ] **Step 3: Production web env, CSP, Hosting deploy**

`apps/web/.env.production.example`:
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project>
VITE_FIREBASE_APP_ID=
VITE_API_URL=https://wayfare-api.<subdomain>.workers.dev
```
Create `apps/web/.env.production` from it. In `infra/firebase/firebase.json` replace `<cf-subdomain>` and `<project>` in the CSP. Then:
```powershell
pnpm --filter @wayfare/web build
cd infra/firebase; pnpm dlx firebase-tools@14 deploy --only hosting --project <project>
```
Expected: `https://<project>.web.app` serves the app.

- [ ] **Step 4: Point the Worker at the real origin**

Edit `apps/api/wrangler.toml`: `ALLOWED_ORIGIN = "https://<project>.web.app"`, then `pnpm --filter @wayfare/api deploy`.

- [ ] **Step 5: Production smoke (the Phase 0 "done when")**

1. Open `https://<project>.web.app`, sign in with Google, click **Call protected /ping** → uid + server time appear.
2. Open `https://<project>.web.app/admin` → "Admin ping: uid … auth age …"; click **Test LLM chain** → JSON with `modelUsed` (the first non-exhausted model, expected `gemini-3.8-flash`) and the attempts list. If a model id in `registry.json` is rejected by the provider (`invalid_request`), fix the id and redeploy — the chain will have fallen through meanwhile.
3. In a private window sign in with a *different* Google account → `/admin` shows "This area is for the owner only."
4. Firestore console: `usageDaily/google_<date>` shows counts; the KV namespace shows `sa_access_token`.

- [ ] **Step 6: Commit config changes**

```bash
git add apps/api/wrangler.toml infra/firebase apps/web/.env.production.example
git commit -m "chore: production origin, admin uid in rules, hosting CSP for the deployed worker"
```

---

### Task 14: `dev.bat` and `prod.bat` — one-command local stack and guarded production deploy

**Files:**
- Create: `dev.bat`, `prod.bat` (repo root)
- Verify: `.gitignore` covers `.env`, `.dev.vars` (Task 1's `tools/test/gitignore.test.ts` already asserts both — re-run it here)
- Depends on: `infra/firebase/firebase.json` emulators block (auth 9099, firestore 8080, UI 4000 — Task 11), Worker emulator support (`FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST` — Tasks 7 and 9), web emulator support (`VITE_USE_EMULATORS` — Task 12), Hosting `index.html` no-cache header (Task 11).

**Interfaces:**
- Produces: `dev.bat [--all|--app|--api|--emulators]`, `prod.bat [--all|--app|--api|--rules|--build-only]`. Both scripts are modelled on `c:\Lexor\dev.bat` / `c:\Lexor\deploy.bat` and keep their conventions: ANSI colours via `for /F %%a in ('echo prompt $E ^| cmd')`, `[INFO]/[WARN]/[ERROR]` prefixes, `npx -y concurrently -c … -n …`, placeholder secret-file creation, "Services configured" summary, `:parse_args` loop, interactive numbered menu when no args, `DEPLOY_TARGETS` accumulation, secrets-sync block with temp file + delete, `[BUILD]/[OK]/[DEPLOY]` lines, `:error`/`:end` labels.
- Env var names are exactly those of the Global Constraints: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `ADMIN_UIDS`, `FIREBASE_SERVICE_ACCOUNT`, `VITE_API_URL`, `VITE_USE_EMULATORS`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`.

Why wrangler gets `--var` instead of `set X=…&&`: `wrangler dev` does not copy arbitrary process environment variables into the Worker's `env` bindings; `--var NAME:VALUE` does. Vite, by contrast, does read `VITE_*` from the process environment, so `set VITE_…&&` works for the app.

- [ ] **Step 1: Write `dev.bat`**

```bat
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

set "FIREBASE_PROJECT=<project>"
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
```

- [ ] **Step 2: Write `prod.bat`**

```bat
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

set "FIREBASE_PROJECT=<project>"
set "WORKER_NAME=wayfare-api"
set "HOSTING_URL=https://<project>.web.app"

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
    for %%S in (GEMINI_API_KEY OPENROUTER_API_KEY TAVILY_API_KEY ADMIN_UIDS FIREBASE_SERVICE_ACCOUNT) do (
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
```

- [ ] **Step 3: Fill the project constants**

Replace `<project>` in both scripts with the real Firebase project id (same value as `wrangler.toml` and `.firebaserc`). Both files are ASCII-only on purpose (cmd.exe and UTF-8 do not mix); keep them that way.

- [ ] **Step 4: Test `dev.bat --app`**

Run in one terminal: `dev.bat --app`. In another: `curl.exe -s -o NUL -w "%{http_code}" http://localhost:5173/`
Expected: `200`; the concurrently banner shows `[APP]` in blue; editing `apps/web/src/routes/index.tsx` (change the tagline) updates the browser without a reload. Stop with Ctrl+C.

- [ ] **Step 5: Test `dev.bat` (all) end to end against emulators**

Run `dev.bat`. Expected: three coloured streams `[EMU]` green, `[API]` magenta, `[APP]` blue; Emulator UI at http://127.0.0.1:4000; `curl.exe http://127.0.0.1:8787/health` → 200. In the app, click **Sign in with Google** → the Auth **emulator** sign-in page appears (not Google's) → choose/create a test account → **Call protected /ping** → uid + server time; the Emulator UI shows `users/<uid>` and `metrics/global` in Firestore. The Worker log shows the `AUTH EMULATOR MODE` warning once per request. Stop with Ctrl+C.

- [ ] **Step 6: Test `prod.bat --build-only`**

With a clean tree: `prod.bat --build-only`
Expected: preflight passes (typecheck, lint, tests, audit), web build + bundle scan run, "Build Complete (deploy skipped)"; `apps\web\dist\index.html` exists. Then dirty the tree (`echo x>> README.md`) and run again → aborts at `[PREFLIGHT] Checking git working tree` with `[ERROR]`; `git checkout README.md`.

- [ ] **Step 7: `.gitignore` check**

Run: `pnpm --filter @wayfare/tools test` — Expected: the `gitignore.test.ts` cases for `.env` and `apps/api/.dev.vars` PASS. Also `git status --short` must not list `.env` or `apps/api/.dev.vars` after the dev run created them.

- [ ] **Step 8: Real deploy via `prod.bat --all`** (replaces the manual Task 13 commands for future deploys)

Fill the repo-root `.env` with the five secrets. Run `prod.bat --all`.
Expected: `[SECRETS]` shows `[OK]` for all five; Worker deployed; `firebase deploy --only hosting,firestore:rules` succeeds; "Live at: https://<project>.web.app"; a `deploy-YYYYMMDD-HHMM` tag is pushed. Repeat the Task 13 Step 5 smoke.

- [ ] **Step 9: Commit**

```bash
git add dev.bat prod.bat
git commit -m "chore: dev.bat (emulators + worker + app) and prod.bat (guarded deploy with secret sync)"
```

---

### Task 15: CI and CD on GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [master]
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "21" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm --filter @wayfare/domain --filter @wayfare/providers --filter @wayfare/api --filter @wayfare/web --filter @wayfare/tools test
      - run: pnpm --filter @wayfare/firebase-rules test
      - run: pnpm audit --audit-level high
      - run: pnpm --filter @wayfare/web build
        env:
          VITE_FIREBASE_API_KEY: ci
          VITE_FIREBASE_AUTH_DOMAIN: ci.firebaseapp.com
          VITE_FIREBASE_PROJECT_ID: ci
          VITE_FIREBASE_APP_ID: ci
          VITE_API_URL: https://ci.invalid
      - name: Bundle secret scan (after build)
        run: pnpm --filter @wayfare/tools exec vitest run test/bundleSecrets.test.ts
      - name: Repo secret scan (all tracked files)
        run: git ls-files | xargs node tools/scripts/secret-scan.mjs
```

- [ ] **Step 2: Deploy workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [master]
concurrency: { group: deploy, cancel-in-progress: false }
jobs:
  worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/api
          command: deploy
  web-and-rules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wayfare/web build
        env:
          VITE_FIREBASE_API_KEY: ${{ vars.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ vars.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_APP_ID: ${{ vars.VITE_FIREBASE_APP_ID }}
          VITE_API_URL: ${{ vars.VITE_API_URL }}
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: ${{ secrets.FIREBASE_PROJECT_ID }}
          channelId: live
          entryPoint: infra/firebase
      - name: Deploy Firestore rules
        working-directory: infra/firebase
        env:
          SA_JSON: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
        run: |
          printf '%s' "$SA_JSON" > "$RUNNER_TEMP/sa.json"
          GOOGLE_APPLICATION_CREDENTIALS="$RUNNER_TEMP/sa.json" pnpm dlx firebase-tools@14 deploy --only firestore:rules --project "${{ secrets.FIREBASE_PROJECT_ID }}" --non-interactive
```

- [ ] **Step 3: Push and verify**

```bash
git add .github
git commit -m "ci: lint, typecheck, unit and rules tests; deploy worker, hosting and rules on master"
git push origin master
```
Expected: **CI** green; **Deploy** green; site and Worker redeployed; repeat Task 13 Step 5.

---

### Task 16: Repository docs for Phase 0

**Files:**
- Modify: `README.md` (append a "Development" section)
- Create: `docs/RUNBOOK.md`

- [ ] **Step 1: README development section**

Append to `README.md`:
````markdown
## Development

Prerequisites: Node 22, pnpm 10, Java 21 (Firestore emulator), a Firebase Spark project, a Cloudflare account, Gemini and OpenRouter free keys — see `docs/superpowers/plans/2026-09-20-phase-0-foundations.md`, Task 0.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test      # unit tests: domain, providers, api, web
pnpm --filter @wayfare/firebase-rules test   # Firestore rules against the emulator
pnpm --filter @wayfare/api dev               # Worker on http://localhost:8787 (needs apps/api/.dev.vars)
pnpm --filter @wayfare/web dev               # SPA on http://localhost:5173 (needs apps/web/.env)
```

Secrets live only in `apps/api/.dev.vars` locally and as Cloudflare Worker secrets in production. Admin access is the UID list in `infra/firebase/firestore.rules` plus the `ADMIN_UIDS` Worker secret.
````

- [ ] **Step 2: Runbook**

`docs/RUNBOOK.md`:
```markdown
# Runbook (Phase 0)

## Rotate a leaked key
1. Revoke in the provider console (AI Studio / OpenRouter / GCP service-account keys).
2. `cd apps/api && pnpm dlx wrangler@4 secret put <NAME>` with the new value.
3. For the service account also update the GitHub secret `FIREBASE_SERVICE_ACCOUNT`.
4. Delete the cached token: KV key `sa_access_token` in the Cloudflare dashboard.

## Add or remove an admin
1. Find the Firebase UID under Authentication → Users.
2. Edit `isAdmin()` in `infra/firebase/firestore.rules`, commit and push (the Deploy workflow ships the rules).
3. `wrangler secret put ADMIN_UIDS` with the new comma-separated list.

## Model quota exhausted
- `usageDaily/<provider>_<day>` shows per-model outcome counts; KV keys `exhausted:<model>` show until when.
- Disable a model: `enabled: false` in `packages/domain/src/models/registry.json`, commit, push.

## Free-tier watch
- Firestore reads/writes: Firebase console → Usage. Workers requests and KV writes: Cloudflare dashboard → Workers & Pages.
```

- [ ] **Step 3: Commit and push**

```bash
git add README.md docs/RUNBOOK.md
git commit -m "docs: development setup and Phase 0 runbook"
git push origin master
```

---

### Task 17: Security review (independent) and remediation

**Files:**
- Create: `docs/superpowers/reviews/YYYY-MM-DD-phase-0-security-review.md` (dated the day the review is performed, e.g. `2026-10-05-phase-0-security-review.md`)
- Modify: whatever the findings require, each fix accompanied by a test
- Create/Modify: `docs/superpowers/backlog/phase-6-hardening.md` (low findings)

**Interfaces:**
- Consumes: the deployed Phase 0 stack (Task 13/14), the CI run (Task 15), spec §8.
- Produces: a review document with findings rated **high / medium / low**, and a remediation commit per high/medium finding. **Phase 0 is not done until this task ends with zero open high/medium findings** (Global Constraints).

**Who performs it:** a **fresh reviewer** — a separate subagent started with only this task, the spec and read access to the repo, or the owner personally. **Not the implementer** of Tasks 1–16. The reviewer must not consult the implementer's reasoning, only the code, the tests, the running system and the checklist below. If a subagent is used, launch it with the instruction: "You are an independent security reviewer. Do not fix anything. Read spec §8 and the Phase 0 plan's Task 17 checklist, inspect the repository and the deployed app, run the listed commands, and write the review document with evidence for every item."

- [ ] **Step 1: Reviewer runs the automated evidence**

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high                     # dependency vulnerabilities
pnpm test                                         # domain, providers, api (auth/admin/cors/headers/rate-limit), web, tools (gitignore, secret-scan)
pnpm --filter @wayfare/firebase-rules test        # rules emulator suite
pnpm scan:bundle                                  # builds web and scans dist for secrets
git ls-files | xargs node tools/scripts/secret-scan.mjs   # tracked files
git log --all --oneline -- '*.env' '*.dev.vars' '*service-account*' '*.pem'   # must print nothing
```
Record each command's result (pass/fail + notable output) in the review under "Automated evidence".

- [ ] **Step 2: Reviewer walks the checklist (derived from spec §8) and records PASS / FAIL with evidence for every line**

```markdown
## Checklist — spec §8 applied to Phase 0

### A. Token path (Worker)
- [ ] A1 Only RS256 accepted; `alg: none` and HS256 tokens rejected in production mode (test: apps/api/test/auth.test.ts "alg none", "alg HS256").
- [ ] A2 `iss` must equal https://securetoken.google.com/<projectId>; `aud` must equal <projectId> (tests present and passing).
- [ ] A3 Expired tokens rejected; `auth_time` in the future rejected.
- [ ] A4 `sub` must be non-empty; `email_verified` must be exactly `true`.
- [ ] A5 JWKS fetched from Google's securetoken endpoint with caching/cooldown; no key material in the repo.
- [ ] A6 Emulator mode is gated solely by `FIREBASE_AUTH_EMULATOR_HOST`; `wrangler.toml` has no such var; `wrangler secret list` shows no such secret; production `/ping` rejects an unsigned token (manual probe with a hand-made alg:none JWT → 401).
- [ ] A7 Malformed/absent Authorization headers → 401 JSON, never 500.

### B. Admin locks
- [ ] B1 Admin UIDs exist only in `firestore.rules` `isAdmin()` and the `ADMIN_UIDS` Worker secret — `grep -r "admins" infra apps` shows no admins collection or client-side allowlist.
- [ ] B2 Every `/admin/*` route (including unknown paths and all methods) returns 403 for a non-admin (test present).
- [ ] B3 State-changing admin requests require `auth_time` ≤ 15 min old (test present); GET allowed with stale auth.
- [ ] B4 `ADMIN_UIDS` parsing ignores whitespace/empties; empty secret grants nobody (test present).
- [ ] B5 Owner's Google account has 2-step verification with a passkey/hardware key (owner attests; recorded in the review).
- [ ] B6 The rules file placeholder `TEST_ADMIN_UID` cannot match a real UID (Firebase UIDs are 28-char alphanumerics; placeholder contains underscores) — confirm and note.

### C. Secrets handling
- [ ] C1 `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `ADMIN_UIDS`, `FIREBASE_SERVICE_ACCOUNT` appear only in: `Env` type, `.dev.vars`/`.env` (git-ignored), `*.example` (empty), `dev.bat`/`prod.bat`, tests with fake values. `git grep -n "AIza\|sk-or-v1\|tvly-\|private_key"` over tracked files returns only allow-listed test/scan files.
- [ ] C2 Bundle scan passes; manual `grep -R "securetoken\|oauth2.googleapis" apps/web/dist` is empty.
- [ ] C3 Service account has exactly the roles listed in Task 0 (Cloud Datastore User; Hosting Admin + Rules Admin only if the same account is used for CI) — check IAM.
- [ ] C4 KV contains only `sa_access_token` and `exhausted:*` keys; the access token TTL ≤ 55 min.
- [ ] C5 Pre-commit secret scan hook is installed (`.git/hooks/pre-commit` → simple-git-hooks) and blocks a staged fake key (reviewer tries it).
- [ ] C6 `.gitignore` test passes for `.env`, `.dev.vars`, `*service-account*.json`, `*.pem`, `*.p12`, `*.key`.

### D. Firestore rules
- [ ] D1 Deny-by-default catch-all present and last.
- [ ] D2 Anonymous denied on every collection (parameterised test present).
- [ ] D3 Users cannot read/write other users' `users/*`, `plans/*` (test present).
- [ ] D4 No client can write `config/*`, `llmModels/*`, `usageDaily/*`, `metrics*`, `auditLog/*`, not even the admin UID (test present).
- [ ] D5 Rules require `email_verified == true` for any authenticated access (test present).
- [ ] D6 Deployed rules equal the repo's `firestore.rules` (Firebase console → Rules → compare hash/last deploy time to the latest Deploy run).

### E. Headers, CSP, CORS
- [ ] E1 Worker responses (200/401/403/404/429/500) carry HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options, CSP `frame-ancestors 'none'`, Permissions-Policy, Cache-Control no-store (test present; verify live with `curl -I`).
- [ ] E2 Hosting responses carry HSTS, nosniff, Referrer-Policy, Permissions-Policy, CSP with `frame-ancestors 'none'` and a `connect-src` limited to the Worker URL + Google auth endpoints (verify live with `curl -I https://<project>.web.app`).
- [ ] E3 `index.html` served with `Cache-Control: no-cache, no-store, must-revalidate`; `/assets/*` immutable.
- [ ] E4 CORS: foreign Origin gets no ACAO on simple and preflight requests; allowed origin succeeds (test present; verify live with `curl -H "Origin: https://evil.test" -I <worker>/health`).
- [ ] E5 `ALLOWED_ORIGIN` in `wrangler.toml` equals the Hosting origin exactly (scheme + host, no trailing slash).

### F. Error leakage and logging
- [ ] F1 Thrown errors return `{ error: "internal", message: "Internal error" }` with no stack or message (test present).
- [ ] F2 Worker logs contain uid/plan id/path/model only — grep the log statements for `email`, `brief`, `token`, `authorization`: none logged.
- [ ] F3 Auth failure messages do not echo the token.

### G. Dependencies and supply chain
- [ ] G1 `pnpm audit --audit-level high` clean (or each finding has a documented override with expiry).
- [ ] G2 Lockfile committed; CI uses `--frozen-lockfile`; `packageManager` pinned in root package.json.
- [ ] G3 GitHub Actions use pinned major versions; secrets are not echoed in logs (check the latest Deploy run log for the SA JSON — must be masked/absent).
- [ ] G4 Dependabot config present or scheduled for Phase 6 (record which).

### H. Rate limiting (baseline)
- [ ] H1 61st request/min from one IP → 429 with Retry-After (test present); documented as Phase 6 baseline, not a distributed guarantee.

### I. Deployment hygiene
- [ ] I1 `prod.bat` refuses a dirty working tree (reviewer verifies by dirtying the tree).
- [ ] I2 `prod.bat` aborts on `pnpm audit --audit-level high` failure (reviewer verifies by temporarily adding a known-vulnerable dev dependency in a scratch branch, or by inspecting the script logic if no such package is at hand — record which).
- [ ] I3 `prod.bat` runs the bundle secret scan after the web build and aborts on failure.
- [ ] I4 Deploy tags exist for each production deploy (`git tag -l "deploy-*"`).

### J. Privacy minimums for Phase 0 data
- [ ] J1 `users/{uid}` stores no email/name (only tier, dates, flags); `metricsDaily` holds counters only.
- [ ] J2 Account deletion is not yet implemented — recorded as an accepted Phase 3 gap (spec §13 G-L2), not a finding.
```

- [ ] **Step 3: Reviewer writes the review document**

`docs/superpowers/reviews/YYYY-MM-DD-phase-0-security-review.md` structure:
```markdown
# Phase 0 Security Review — <date>
Reviewer: <name / subagent id>  ·  Commit reviewed: <sha>  ·  Deployed Worker version: <wrangler deployments list id>

## Automated evidence
| Command | Result | Notes |
|---|---|---|
| pnpm audit --audit-level high | PASS/FAIL | … |
| … | | |

## Checklist results
(The full checklist above with each box ticked PASS or marked FAIL + evidence link/line.)

## Findings
| ID | Severity (high/medium/low) | Item | Description | Evidence | Recommended fix |
|---|---|---|---|---|---|
| F-1 | high | A6 | … | … | … |

## Verdict
Open high: N · Open medium: N · Low (to Phase 6 backlog): N
```
Severity guide: **high** = a stranger can read/write another user's data, obtain a secret, or bypass auth/admin; **medium** = a defence from spec §8 is missing or untested but not directly exploitable today; **low** = hardening/hygiene with no current exposure.

- [ ] **Step 4: Remediation (implementer, not reviewer)**

For **every high and medium finding**: write a failing test that demonstrates the finding → fix → test passes → commit `fix(security): <finding id> <summary>` referencing the review file. Re-run Step 1. Ask the reviewer to re-verify the specific items and update the review's Verdict.
For **every low finding**: append to `docs/superpowers/backlog/phase-6-hardening.md` as a checklist item with the finding id and evidence.

- [ ] **Step 5: Close-out**

Phase 0 is marked done only when the review's Verdict reads `Open high: 0 · Open medium: 0`. Commit:
```bash
git add docs/superpowers/reviews docs/superpowers/backlog
git commit -m "docs(security): Phase 0 independent security review and remediation record"
git push origin master
```

---

## Self-Review

**Task map:** 0 accounts · 1 scaffold + gitignore tests + pre-commit secret scan · 2 domain basics · 3 model registry · 4 LLM adapters · 5 ModelRouter · 6 Worker scaffold (CORS, headers, error hygiene, rate-limit baseline) · 7 token verification (+ emulator mode) · 8 admin guard · 9 Firestore client + `/ping` (+ emulator host) · 10 quota store + admin LLM ping · 11 rules + emulator tests · 12 web app (+ emulator wiring, bundle scan) · 13 first deploy · **14 `dev.bat` / `prod.bat`** · 15 CI/CD · 16 docs · **17 independent security review + remediation**.

**Spec coverage (Phase 0 contents, spec §11):**
- Monorepo → Task 1. Firebase Spark project → Task 0. Worker with token verification → Tasks 6–7. Rules + emulator tests → Task 11. CI → Task 15. Model registry + chain router + quota tracking → Tasks 3, 5, 10 (Firestore counters, KV flags — per the KV write ceiling in Global Constraints). Admin UID locks → Tasks 8, 11, 13. Locale registry → Tasks 2, 12. "Done when: signed-in user calls protected `/ping`; admin lock tests pass" → Task 13 Step 5 / Task 14 Step 5 plus the tests in Tasks 8 and 11; **and** Task 17's Verdict shows no open high/medium findings (Global Constraints).
- §7.1 KPI counters begin here (`metrics/global`, `metricsDaily`) → Task 9; the dashboard UI is a later phase.
- §8 items in Phase 0 scope, each with an automated test: token rules (Task 7: expired, wrong iss, wrong aud, alg none, HS256, missing/empty sub, `email_verified` false/absent, future `auth_time`, malformed headers, emulator gating), admin locks (Task 8: 403 on every `/admin/*`, 15-min freshness on non-GET, `ADMIN_UIDS` parsing), CORS lock and security headers on every response incl. errors, no stack-trace leakage (Task 6), rate-limit baseline (Task 6), secrets only in the Worker (Task 1 gitignore tests + pre-commit scan; Task 12 bundle scan; Task 15 CI scans), deny-by-default rules with anonymous/other-user/admin-write sweeps (Task 11). App Check, distributed rate limits and the audit log remain Phase 6 by spec; the in-memory limiter is explicitly a baseline.
- §2.5 i18n registry with `dir` from the row → Tasks 2, 12.
- Local development and deployment ergonomics (owner request): Task 14, with emulator support threaded through Tasks 7, 9, 11, 12 and the `index.html` no-cache header in Task 11.

**Placeholder scan:** The only placeholders are values the executor obtains from their own accounts — `<project>`, `<kv-id>`, `<subdomain>`/`<cf-subdomain>`, `<your-uid>`, the generated `TEST_PEM`, and the review file's `YYYY-MM-DD` date — and each has an explicit instruction for where the value comes from. No "TBD"/"TODO".

**Type and name consistency:** `QuotaStore.recordCall(entry: ModelEntry, outcome, now)` is identical in Tasks 5 and 10. `AppEnv`/`AppVariables.deps` (`fetchImpl`, `now`, `jwks?`) are consumed the same way in Tasks 6–10. `firestoreFor(env, fetchImpl, now)` defined in Task 9 is imported in Task 10. `PingResponse`/`AdminPingResponse`/`LlmPingResponse` (Task 2) match the JSON produced in Tasks 7–10 and parsed in Task 12. `providerDayKey` (Task 5) is used by `FirestoreQuotaStore` (Task 10). `fakeFirestore`, `TEST_PEM`/`TEST_SA_JSON` and `makeTestJwks` are shared helpers introduced in Tasks 7 and 9 and reused in Tasks 9–10. The `AuthUser` stub in Task 6 is replaced by the real type in Task 7 with the same `uid` field. `verifyIdToken(token, projectId, getKey, now, { emulator })` (Task 7) is the only signature used by the middleware. `FirestoreClientOptions.host` (Task 9) is the only knob `firestoreFor` uses for the emulator. Environment variable names are identical everywhere they appear — `Env` (Task 6), `.dev.vars.example` (Task 6), `.env.example` (Task 1), `vitest` bindings (Task 6), `wrangler secret put` (Task 13), `dev.bat`/`prod.bat` (Task 14), CI (Task 15): `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `ADMIN_UIDS`, `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`; web: `VITE_API_URL`, `VITE_USE_EMULATORS`, `VITE_FIREBASE_*`.
