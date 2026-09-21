# Phase 0 Security Review — 2026-09-22

Reviewer: independent security-review subagent · Commit reviewed: `8d8df4dcbb17f44d296d8be2266a4aa8499bd80c` · Deployed Worker version: not retrieved (`wrangler deployments list` was not run)

Remediation of every high and medium finding is in the commit that adds this file. Live Hosting and the Worker were not redeployed, so production still serves the pre-fix CSP and `/admin` cache header until the next deploy.

`isAdmin()` still lists only `TEST_ADMIN_UID`. That placeholder is accepted until the owner UID is appended (Task 13 step 2). It is not a defect: Firebase UIDs are 28-character alphanumeric strings, and this placeholder contains underscores, so it cannot match a Google-issued UID.

## Automated evidence

| Command | Result | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | not re-run as frozen | `pnpm install` was run to apply the dev-tool overrides and refresh `pnpm-lock.yaml`. |
| `pnpm audit --audit-level high` | PASS after remediation | Before the override: 1 critical and 16 high, all under `firebase-tools` → `tar` and `vitest-pool-workers` → `miniflare` (`undici`, `ws`, `sharp`). After: exit 0, 1 low and 7 moderate remaining. |
| `pnpm test` | PASS | domain, providers, api (41), web (6), tools (25) after the fixes. |
| `pnpm --filter @wayfare/firebase-rules test` | PASS | 29 emulator tests. `firebase --version` still prints 14.27.0 after the `tar` override. |
| `pnpm scan:bundle` | PASS | Web production build, then `bundleSecrets.test.ts`. |
| `git ls-files` secret scan | PASS after remediation | Before the plan edit, the scan exited 1 on PEM-header literals in the Phase 0 plan (no live key). After: `[secret-scan] clean`. |
| `git log --all --oneline -- '*.env' '*.dev.vars' '*service-account*' '*.pem'` | PASS | No commits. |
| Manual `grep` of `apps/web/dist` for `securetoken@system.gserviceaccount.com` and `oauth2.googleapis.com/token` | PASS | No matches. |

## Checklist results

### A. Token path (Worker)

- [x] PASS A1. `verifyIdToken` calls `jwtVerify` with `algorithms: ["RS256"]`. `apps/api/test/auth.test.ts` rejects `alg: none` and HS256. Live `POST` equivalent: `GET /ping` with a hand-made `alg: none` bearer returned 401 and did not accept the token.
- [x] PASS A2. Issuer must be `https://securetoken.google.com/<projectId>` and audience must be `<projectId>`. Tests: wrong audience, wrong issuer.
- [x] PASS A3. Expired tokens are rejected (`exp` checked by jose when present). `auth_time` more than 60 seconds in the future is rejected. See L6: up to 60 seconds of future `auth_time` is allowed, and a token with no `exp` is not rejected (L5).
- [x] PASS A4. Empty or missing `sub` is rejected. `email_verified` must be exactly `true` (false and absent are tested).
- [x] PASS A5. JWKS URL is Google's securetoken certs endpoint, with `cooldownDuration` 30s and `cacheMaxAge` 6h. No private key material for that endpoint is in the repo. The test PEM is confined to `apps/api/test/helpers/testPem.ts`.
- [x] PASS A6, with gaps noted. Emulator acceptance is gated only by a non-empty `FIREBASE_AUTH_EMULATOR_HOST`. `wrangler.toml` `[vars]` does not set it. Live unsigned token → 401. `wrangler secret list` was not run, so a production secret of that name was not confirmed absent.
- [x] PASS A7. Missing, wrong-scheme, and garbage `Authorization` values return 401 JSON. Tests cover them.

### B. Admin locks

- [x] PASS B1. Admin identity is `isAdmin()` in `infra/firebase/firestore.rules` plus the `ADMIN_UIDS` Worker secret. `grep` of `admins` under `apps` and `infra` source found no admins collection and no client allowlist.
- [x] PASS B2. `adminRoutes.use("*", firebaseAuth, requireAdmin())` runs before routing. `admin.test.ts` expects 403 for a non-admin on known routes, unknown paths, and DELETE.
- [x] PASS B3. Non-GET/HEAD admin calls require `auth_time` within `freshAuthMaxAgeSec` (15 minutes). GET with a 16-minute-old `auth_time` returns 200; POST returns 401 `reauth_required`.
- [x] PASS B4. `parseAdminUids` trims and drops empties. An empty `ADMIN_UIDS` returns 403 for an otherwise valid admin token.
- [ ] UNVERIFIED B5. This review did not receive an owner attestation that the Google account has 2-step verification with a passkey or hardware key. Not counted as a code defect.
- [x] PASS B6. `TEST_ADMIN_UID` contains underscores and is not 28 alphanumeric characters. Accepted until the owner UID is appended beside it.

### C. Secrets handling

- [x] PASS C1 after remediation. See F-1. Tracked `git grep` for `AIza`, `sk-or-v1`, `tvly-`, and `private_key` now hits only scanner/test/plan pattern text and the allow-listed test PEM helper, not a populated example value. Local `.env` / `.dev.vars` values were compared by length and equality only; the example client key was not the Gemini, OpenRouter, Tavily, or service-account secret.
- [x] PASS C2. Bundle scan passed. Manual grep of `apps/web/dist` for the Worker JWKS identity and the OAuth token URL was empty.
- [ ] UNVERIFIED C3. IAM for the service account was not inspected. Code requests only the `datastore` OAuth scope.
- [x] PASS C4 for the code path; live KV was not listed. `getAccessToken` stores `sa_access_token` with `expirationTtl` of at most 3300 seconds (55 minutes). Quota exhaustion uses `exhausted:*`.
- [x] PASS C5. `.git/hooks/pre-commit` runs `pnpm secret-scan`. A staged throwaway file containing an `AIza` prefix plus 35 `A`s was rejected (`Google API key in tmp-secret-probe.ts`, exit 1). The file was unstaged and deleted.
- [x] PASS C6. `tools/test/gitignore.test.ts` covers `.env`, `.dev.vars`, `*service-account*.json`, `.pem`, `.p12`, and `.key`.

### D. Firestore rules

- [x] PASS D1. `match /{document=**} { allow read, write: if false; }` is the last match.
- [x] PASS D2. `test.each(ALL_COLLECTIONS)` denies anonymous read and write.
- [x] PASS D3. A user cannot read or write another user's `users/*` or `plans/*`.
- [x] PASS D4. Client writes to `config/*`, `llmModels/*`, `usageDaily/*`, `metrics*`, and `auditLog/*` fail for the admin UID and for a normal user.
- [x] PASS D5. `signedIn()` requires `request.auth.token.email_verified == true`. Unverified email is denied.
- [ ] UNVERIFIED D6. Deployed rules were not downloaded for a hash compare. Repo rules were tested on the emulator.

### E. Headers, CSP, CORS

- [x] PASS E1 for the Worker code and the live samples that were fetched. `securityHeaders` sets HSTS, nosniff, no-referrer, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, Permissions-Policy, and `Cache-Control: no-store`. Tests cover 200, 404, 401, and a thrown 500. Live `GET /health` and unauthenticated `GET /ping` carried the same set. `curl -I` was used for `/health`.
- [x] PASS E2 after remediation in the repo. See F-4. Live `https://tripdesignai.web.app/` already has HSTS, nosniff, Referrer-Policy, Permissions-Policy, and `frame-ancestors 'none'`. Its `connect-src` still contains `https://*.googleapis.com` until the next Hosting deploy. Live HSTS `max-age` is 31556926 (Firebase Hosting's value), not the 63072000 in `firebase.json` (L15).
- [x] PASS E3 after remediation in the repo. See F-5. Live `/` and `/index.html` are `no-cache, no-store, must-revalidate`. Live `/admin` was `max-age=3600` before this fix.
- [x] PASS E4. Tests and live checks: `Origin: https://evil.test` gets no `Access-Control-Allow-Origin`; `Origin: https://tripdesignai.web.app` gets that exact origin. `wrangler.toml` `ALLOWED_ORIGIN` is `https://tripdesignai.web.app` with no trailing slash.
- [x] PASS E5. `ALLOWED_ORIGIN` matches the Hosting origin exactly.

### F. Error leakage and logging

- [x] PASS F1. Thrown errors return `{ error: "internal", message: "Internal error" }` with no stack. Test includes a sentinel string that must not appear in the body.
- [x] PASS F2 after remediation. See F-3. The emulator warning still contains the static word "tokens" and does not log a token value.
- [x] PASS F3. Auth failures return jose's claim/algorithm text (`unexpected "aud" claim value`, `"alg" (Algorithm) Header Parameter value not allowed`). Those messages do not include the raw bearer token. Live `alg: none` response did not echo the token.

### G. Dependencies and supply chain

- [x] PASS G1 after remediation. See F-6. High and critical are clear. Moderate and low remain (L14).
- [x] PASS G2. `pnpm-lock.yaml` is committed. CI and `prod.bat` use `pnpm install --frozen-lockfile`. Root `packageManager` is `pnpm@10.15.0`.
- [x] PASS G3 for the letter of the checklist. Actions use major tags (`@v4`, `@v3`, `@v0`), not commit SHAs (L8). Deploy writes the service account to `$RUNNER_TEMP/sa.json` via `printf` and does not echo it. A live Deploy log was not opened.
- [x] PASS G4 as scheduled, not present. No Dependabot config. Tracked as L1 in the Phase 6 backlog.

### H. Rate limiting (baseline)

- [x] PASS H1. The 61st request in a minute from one `cf-connecting-ip` returns 429 with `Retry-After`. Documented as a per-isolate baseline. Per-UID limiting does not run (L4).

### I. Deployment hygiene

- [x] PASS I1. With a dirty tree, `prod.bat --build-only` printed `Working tree has uncommitted changes` and exited 1 before install or deploy.
- [x] PASS I2 by inspection. `prod.bat` runs `pnpm audit --audit-level high` and `if errorlevel 1` jumps to `:error`. A vulnerable package was not injected. Before F-6 this step would have aborted; after F-6 the audit command itself exits 0.
- [x] PASS I3 by inspection. After `pnpm --filter @wayfare/web build`, `prod.bat` runs `bundleSecrets.test.ts` and aborts on failure. The dirty-tree check stopped the script before that step in this review.
- [ ] FAIL I4 (low, L13). `git tag -l "deploy-*"` printed nothing. `.github/workflows/deploy.yml` does not create tags. The site is live, so at least one production deploy happened without a `deploy-*` tag.

### J. Privacy minimums

- [x] PASS J1. `GET /ping` writes `createdAt`, `lastActiveDate`, `tier`, `tierSource`, `freeGenerationUsed`, `plusRequested`, and `locale` on `users/{uid}`. No email or name. `metricsDaily` counters are numeric increments.
- [x] ACCEPTED J2. Account deletion is not implemented. Spec §13 G-L2, Phase 3. Not a finding.

## Findings

| ID | Severity | Item | Description | Evidence | Status |
|---|---|---|---|---|---|
| F-1 | medium | C1 | `apps/web/.env.production.example` held a 39-character Firebase web API key (`AIza` prefix). `secret-scan.mjs` exempted every `*.example` path, so the pre-commit hook and the tracked-file scan both missed it. The value matched the local web client key and did not match the Gemini, OpenRouter, Tavily, or service-account secrets. | `git grep` hit that example file only for a real key. Scanner `ALLOW` included `/\.example$/`. | Remediated. Example value cleared. Examples are scanned. The key remains in git history and, by design, in the client bundle; the owner should restrict it to the Hosting referrer and Identity Toolkit. The value is not repeated here. |
| F-2 | medium | C1, C5 | If `gitleaks` was on `PATH`, the scanner ran `gitleaks protect --staged` and exited, skipping project patterns and any explicit paths (`git ls-files \| xargs`). | `tools/scripts/secret-scan.mjs` `process.exit` after a zero gitleaks status. | Remediated. Gitleaks is an extra staged-diff check only. Project patterns always run. |
| F-3 | medium | F2 | `onError` logged `err.message`. `FirestoreClient` put up to 300 characters of the upstream body into that message, so a Firestore error could land user or token text in Worker logs. | `apps/api/src/app.ts`, `apps/api/src/firestore/client.ts`. | Remediated. Logs are `{ level, path, name }`. Firestore errors are `Firestore HTTP <status>` only. |
| F-4 | medium | E2 | Hosting CSP `connect-src` allowed `https://*.googleapis.com`, not only the Worker and Google auth hosts. Live `/` confirmed the wildcard. | `infra/firebase/firebase.json`; `curl -sI https://tripdesignai.web.app/`. | Remediated in the repo. `connect-src` is the Worker origin plus `identitytoolkit`, `securetoken`, `www.googleapis.com`, `firebaseinstallations`, `apis.google.com`, and `accounts.google.com`. `frame-src` keeps the first-party auth hosts the live site already sent (`'self'`, `https://tripdesignai.web.app`, `https://tripdesignai.firebaseapp.com`, `https://accounts.google.com`) because the production auth domain is the Hosting origin. Not deployed yet. |
| F-5 | medium | E3 | Firebase Hosting matches header `source` against the request path. `/` and `**/*.html` set `no-store`, but rewritten routes such as `/admin` do not match those sources. Live `/admin` returned `Cache-Control: max-age=3600` for the same `index.html` body. | `curl -sI https://tripdesignai.web.app/admin`. | Remediated in the repo. The `**` rule now sets `no-store`. `/assets/**` stays later so hashed assets can override to `immutable` (Firebase uses the last matching header). Not deployed yet. |
| F-6 | medium | G1 | `pnpm audit --audit-level high` failed. Critical/high were dev-only: `firebase-tools@14.27.0` → `tar@6.2.1`, and pinned `vitest-pool-workers@0.12.21` → `miniflare@4` → `undici@7.18.2`, `ws@8.18.0`, `sharp@0.34.5`. Not in the Worker or web bundle. `prod.bat` would have refused to deploy. | `pnpm audit --audit-level high`; `pnpm why`. | Remediated. Root `pnpm.overrides` force `tar@6` → 7.5.22, `undici` 7.x below 7.29.0 → 7.29.0, `ws` 8.x below 8.21.0 → 8.21.0, `sharp` below 0.35.4 → 0.35.4. Audit exit 0. |
| F-7 | medium | C1 | The Phase 0 plan contained a PEM begin/end marker and a service-account JSON field as documentation, so the tracked-file scan exited 1 with no live key. A permanently red scan stops being a signal. | Secret scan named `docs/superpowers/plans/2026-09-20-phase-0-foundations.md` lines 463 and 2487 at `8d8df4d`. | Remediated. Those snippets are split the same way as `secretScan.test.ts`, so the sentinel is not contiguous. |
| L1 | low | G4 | No Dependabot config. | No `.github/dependabot.yml`. | Documented only. |
| L2 | low | G2 | Deploy workflow runs on push to `master` in parallel with CI. A red CI job does not block the deploy. | `.github/workflows/deploy.yml` vs `ci.yml`. | Documented only. |
| L3 | low | C2 | `bundleSecrets.test.ts` skips, and therefore passes, when `apps/web/dist` is missing. | `tools/test/bundleSecrets.test.ts` `test.skip`. | Documented only. |
| L4 | low | H1 | `rateLimit` reads `user` before `firebaseAuth`, so the per-UID bucket never fills. Phase 6 owns real per-UID limits. | `apps/api/src/app.ts` middleware order. | Documented only. |
| L5 | low | A3 | jose checks `exp` only when the claim is present. Firebase-issued tokens include `exp`. | `jose` `jwt_claims_set.js` `validateNumericDate(payload, "exp")`. | Documented only. |
| L6 | low | A3 | `auth_time` up to 60 seconds ahead of the server clock is accepted. The test uses +3600 seconds. | `verifyIdToken.ts`. | Documented only. |
| L7 | low | E2 | Hosting `style-src` includes `'unsafe-inline'`. `script-src` does not. | `firebase.json` CSP. | Documented only. |
| L8 | low | G3 | Actions are pinned to floating major tags. Workflows do not set a least-privilege `permissions` block. | `ci.yml`, `deploy.yml`. | Documented only. |
| L9 | low | C1 | `secret-scan.mjs` still skips `pnpm-lock.yaml`. | `ALLOW` in `secret-scan.mjs`. | Documented only. |
| L10 | low | C1 | `prod.bat` writes each Worker secret to `%TEMP%\wayfare_secret_<NAME>.tmp` for `wrangler secret put`, then deletes the file. | `prod.bat` secret sync loop. | Documented only. |
| L11 | low | A4 | `sub` is interpolated into `users/${uid}` on a service-account client with no UID charset check. Google-issued UIDs are not attacker-controlled. | `apps/api/src/routes/ping.ts`. | Documented only. |
| L12 | low | E3 | A missing path under `/assets/**` is rewritten to `index.html` and matches the immutable asset cache rule. Live `GET /assets/` returned the HTML shell with `public, max-age=31536000, immutable`. | `curl -sI https://tripdesignai.web.app/assets/`. | Documented only. |
| L13 | low | I4 | No `deploy-*` tags. The Deploy workflow does not create them. | `git tag -l "deploy-*"`. | Documented only. |
| L14 | low | G1 | After F-6, audit still reports 1 low and 7 moderate, all below the Phase 0 high gate, in dev tooling. | `pnpm audit --audit-level high` exit 0. | Documented only. |
| L15 | low | E2 | Live Hosting HSTS is `max-age=31556926`; the repo asks for `63072000`. Firebase Hosting supplies its own HSTS. | `curl -sI https://tripdesignai.web.app/`. | Documented only. |

## Verdict

Open high: 0 · Open medium: 0 · Low (to Phase 6 backlog): 15

Reviewed at `8d8df4d` there were 0 high and 7 medium findings (F-1 through F-7). Each medium is fixed in this commit with a test, except F-7, which is a documentation edit so the tracked-file scan can pass. Lows are listed above and copied to `docs/superpowers/backlog/phase-6-hardening.md`.
