# Phase 6 hardening backlog

Low findings from the Phase 0 security review (`docs/superpowers/reviews/2026-09-22-phase-0-security-review.md`). Not fixed in Phase 0.

- [ ] L1 — Add Dependabot (or Renovate) for npm and GitHub Actions. No config exists today.
- [ ] L2 — Make `.github/workflows/deploy.yml` run only after the CI workflow succeeds, so a red audit, test, or secret scan cannot ship.
- [ ] L3 — `tools/test/bundleSecrets.test.ts` uses `test.skip` when `apps/web/dist` is missing, so the scan passes without a bundle. Fail closed when the scan is the deploy gate; keep the skip only for the unit-test job that has not built the web app.
- [ ] L4 — `rateLimit` is registered before `firebaseAuth`, so the per-UID bucket never increments. Phase 6 replaces this in-isolate limiter; when it does, key by UID after auth.
- [ ] L5 — `verifyIdToken` does not require an `exp` claim. jose checks expiry only when `exp` is present. Require `exp` (Firebase ID tokens always have it).
- [ ] L6 — `auth_time` up to 60 seconds in the future is accepted. The unit test only covers +3600 seconds. Decide whether the skew window stays, and test the boundary.
- [ ] L7 — Hosting CSP `style-src` includes `'unsafe-inline'`. Drop it if the built CSS no longer needs inline style attributes.
- [ ] L8 — Pin GitHub Actions to commit SHAs and set least-privilege `permissions` on `ci.yml` and `deploy.yml`. `deploy.yml` also installs `firebase-tools@14` with `pnpm dlx` (floating minor/patch).
- [ ] L9 — `tools/scripts/secret-scan.mjs` still allowlists `pnpm-lock.yaml`. Scan it, or replace the blanket skip with a narrower exception.
- [ ] L10 — `prod.bat` writes Worker secret values to `%TEMP%\wayfare_secret_<NAME>.tmp` for `wrangler secret put`. Prefer a pipe that does not leave a file if the process is killed.
- [ ] L11 — `GET /ping` interpolates the token `sub` into a service-account Firestore path. Reject subjects that are not a Firebase UID shape before that call.
- [ ] L12 — Hosting rewrites missing `/assets/**` URLs to `index.html`, and that path matches the immutable cache rule. Live `GET /assets/` returned the HTML shell with `max-age=31536000, immutable`. Do not apply the asset cache header to the SPA fallback.
- [ ] L13 — `git tag -l "deploy-*"` is empty and `deploy.yml` never creates those tags, even though the site is live. Tag deploys from CI the way `prod.bat` does.
- [ ] L14 — `pnpm audit --audit-level high` is clean. 1 low and 7 moderate remain in dev tooling. Clear or time-bound them in Phase 6.
- [ ] L15 — Live Hosting HSTS is `max-age=31556926` while `firebase.json` sets `63072000`. Confirm whether Firebase Hosting overwrites the header and align the repo with what is actually served.
