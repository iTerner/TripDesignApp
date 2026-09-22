# Runbook (Phase 0)

Firebase project: `tripdesignai`.
Hosting: https://tripdesignai.web.app.
Worker: https://wayfare-api.ido-terner.workers.dev (`wayfare-api`).
Local API: http://127.0.0.1:8787.
Local web: http://localhost:5173 via `dev.bat` (once Task 12 has created `apps/web`).

`isAdmin()` in `infra/firebase/firestore.rules` still lists only the placeholder `TEST_ADMIN_UID` until Task 13. That string is not a real Firebase UID. Leave it in the rules list so emulator tests keep passing; Task 13 appends the owner's UID beside it. The Worker secret `ADMIN_UIDS` holds real UIDs only.

## Rotate a leaked key

1. Revoke the key in the provider console (AI Studio / OpenRouter / GCP service-account keys for project `tripdesignai`).
2. `cd apps/api && pnpm dlx wrangler@4 secret put <NAME>` with the new value, targeting Worker `wayfare-api`. Names: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `ADMIN_UIDS`, `FIREBASE_SERVICE_ACCOUNT`, `GITHUB_DISPATCH_TOKEN`.
3. For the service account also update the GitHub secret `FIREBASE_SERVICE_ACCOUNT`.
4. Delete the cached token: KV key `sa_access_token` for `wayfare-api` in the Cloudflare dashboard.

## Add or remove an admin

1. Find the Firebase UID under Authentication → Users in project `tripdesignai`.
2. Edit `isAdmin()` in `infra/firebase/firestore.rules`. Until Task 13 the list is only `'TEST_ADMIN_UID'`; add or remove real UIDs in that array and keep `TEST_ADMIN_UID`. Commit and push (the Deploy workflow ships the rules to `tripdesignai`).
3. `cd apps/api && pnpm dlx wrangler@4 secret put ADMIN_UIDS` with the new comma-separated list of real UIDs.

## Model quota exhausted

- In Firestore project `tripdesignai`, `usageDaily/<provider>_<day>` shows per-model outcome counts. On Worker `wayfare-api`, KV keys `exhausted:<model>` show until when.
- Disable a model: `enabled: false` in `packages/domain/src/models/registry.json`, commit, push.

## Free-tier watch

- Firestore reads/writes: Firebase console → project `tripdesignai` → Usage.
- Workers requests and KV writes: Cloudflare dashboard → Workers & Pages → `wayfare-api` (https://wayfare-api.ido-terner.workers.dev).
- Hosting: https://tripdesignai.web.app.
