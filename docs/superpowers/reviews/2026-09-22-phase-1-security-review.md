# Phase 1 Security Review — 2026-09-22

Reviewer: Phase 1 Task B7 subagent (not the author of B1–B6) · Commit reviewed: `3d3598379b5b7ccd38779d1d871ad5c0eb547fce` · Deployed Worker version: not retrieved

Scope is the Phase 1 scout and admin surface: `packages/firestore`, the scout live writer, lock, quota and SSRF checks, Worker admin routes and GitHub dispatch, `infra/firebase/firestore.rules`, and the web admin screens. Phase 0 leftovers already tracked in the Phase 6 backlog were not reopened.

Remediation of every high and medium finding is in the commits listed under Findings. Live Hosting and the Worker were not redeployed.

## Automated evidence

| Command | Result | Notes |
|---|---|---|
| Secret scan of `apps/scout/fixtures` and `work/README.md` | PASS | `[secret-scan] clean`. The local `work/` tree contained only `README.md` (no packet JSON). |
| `pnpm scan:bundle` | PASS | Production web build, then `bundleSecrets.test.ts`, including `FIREBASE_SERVICE_ACCOUNT` and `GITHUB_DISPATCH_TOKEN`. |
| Scout SSRF, fetch, Gemini, and writer tests | PASS | 38 tests in `ssrf.test.ts`, `fetchPage.test.ts`, `gemini.test.ts`, `07-write.test.ts`. |
| `pnpm --filter @wayfare/firestore test` | PASS | 9 tests, including backtick-quoted `usageDaily` field paths that contain `:` and `.`. |
| `pnpm --filter @wayfare/firebase-rules test` | PASS | 70 emulator tests, including private-notes denial and the admin-only lock document. |
| `pnpm --filter @wayfare/api exec vitest run test/scoutAdmin.test.ts --testTimeout 20000` | PASS | 13 tests. Non-admin POST/DELETE is 403. Stale `auth_time` is 401 `reauth_required`. |
| Typecheck (`scout`, `firestore`, `api`, `tools`) | PASS | `tsc --noEmit`. |
| Biome on the edited files | PASS | `biome check` reported no fixes. |

## Checklist results

### Secrets and execution

- [x] PASS. Packet fixtures under `apps/scout/fixtures` do not match the project secret patterns (Google key, OpenRouter, Tavily, private-key block, `ghp_`).
- [x] PASS. The scout CLI opens Firestore with `FIREBASE_SERVICE_ACCOUNT` via `openScoutFirestore` (`apps/scout/src/firestore/client.ts`). The web app does not reference that name or `GITHUB_DISPATCH_TOKEN`. `pnpm scan:bundle` passed after those names were added to the scanner. See F-5.
- [x] PASS. `.github/workflows/scout.yml` has no `schedule:` key. It is `workflow_dispatch` only. See F-1 for the shell-injection fix.
- [x] PASS. `usageDaily` increments that contain `:` or `.` are backtick-quoted in `quoteFieldPath` (`packages/firestore/src/client.ts`). Test: `incrementFields quotes model ids so dots and colons stay one field`.

### Firestore rules

- [x] PASS. `places/{id}/private/{doc}` is admin-read and client-write denied. A normal user cannot read `places/p1/private/admin`. The admin can. Emulator tests cover both.
- [x] PASS. `pendingMerges`, `scoutRuns`, and `reviewSessions` are admin-read and client-write denied.
- [x] PASS after remediation. `destinations/{slug}/lock/{docId}` is admin-read and client-write denied. See F-2. Parent `destinations` and `places` stay signed-in readable. Client writes stay denied, including for the admin UID.
- [x] PASS. `geocodeCache` stays closed to every client.

### Admin routes

- [x] PASS. `/admin/*` still runs `firebaseAuth` and `requireAdmin()` before scout, place, merge, and review routes. A non-admin receives 403 on every scout write, including run, override, hide, merge, and review.
- [x] PASS. State-changing scout routes are POST or DELETE, so a stale `auth_time` returns 401 `reauth_required` before dispatch or a Firestore write.
- [x] PASS. Place overrides store `by: "admin"` on the public document. Notes and hide reasons go to `places/{id}/private/admin`. Tests assert the public document does not contain the admin UID or the note text.
- [x] PASS after remediation. Successful admin writes append `auditLog/{id}` with `action`, `target`, `actorUid`, and `at`. The note text and the GitHub token are not copied into that row. See F-3. `auditLog` remains admin-read and client-write denied.
- [x] PASS. GitHub dispatch errors stay `GitHub HTTP <status>`. The test token and the upstream body marker are absent from the error and the log line.

### Fetching and quotes

- [x] PASS. `assertPublicUrl` rejects loopback, private, and link-local addresses, including when one of several DNS answers is non-public, and rejects non-http(s) URLs. `ssrf.test.ts` passed.
- [x] PASS after remediation. A `noai` or `noindex` page is not sent to Gemini as page text, including when Tavily already returned `rawContent`. A skipped fetch (SSRF, robots, HTTP) also drops that body. See F-4. `fetchPage` still returns `quoteAllowed: false`, and `verifyFinding` sets `storeQuote: false`, so the quote is not written to evidence.
- [ ] DEFERRED L16. The SSRF check resolves DNS and then `fetch` dials the hostname again, so a rebinding DNS server can change the address between the check and the connection.

### Web admin screens

- [x] PASS by inspection. Scouting, places, review, and merges call `/admin/...` with the Firebase ID token. They do not import the service account or the dispatch token. Private notes are not read from `places/{id}/private/admin`; hide reasons are posted to the Worker. Place and destination tables read Firestore directly, which the rules allow for a signed-in user. Admin-only collections stay admin-read.

## Findings

| ID | Severity | Item | Description | Evidence | Status |
|---|---|---|---|---|---|
| F-1 | high | scout workflow | `run: pnpm scout ${{ inputs.destinations }}` interpolated `workflow_dispatch` input into the shell step that holds `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, and `FIREBASE_SERVICE_ACCOUNT`. The Worker checks the slug, but the Actions API accepts any string from a principal with Actions write, including `GITHUB_DISPATCH_TOKEN`. | `.github/workflows/scout.yml` at `3d35983`. | Remediated in `70d0817`. The slug is an environment variable, the script quotes `"$DESTINATIONS"`, and a shell `case` rejects empty values and characters outside `a-z`, `0-9`, and `-`. Workflow `permissions` are `contents: read`. `tools/test/scoutWorkflow.test.ts` fails if a `run:` script contains `${{`. |
| F-2 | medium | destinations.lock | The run lock lived on `destinations/{slug}`, which any signed-in user can read. Spec §9.6 says `destinations.lock` is admin-read only. Rules cannot hide one field of a readable document. | `apps/scout/src/firestore/lock.ts` and `firestore.rules` at `3d35983`. | Remediated in `473f8ec`. The lock is `destinations/{slug}/lock/current`. A legacy `lock` field on the parent is moved there and deleted, including when the acquire is refused. The writer deletes the lock document when the run finishes or fails. Rules tests deny a normal user and allow the admin. |
| F-3 | medium | audit | Spec §6 requires admin scout writes to be audit-logged. The new routes changed Firestore and dispatched GitHub with no `auditLog` write. | `apps/api/src/routes/scoutAdmin.ts` at `3d35983`. | Remediated in `e0ace7c`. Each successful destination, run, override, hide, merge, and review write appends an audit row. Tests check the row for override, hide, merge, and scout run, and check that the note and the dispatch token are not in it. |
| F-4 | medium | noai | `extractTrends` forwarded Tavily `rawContent` and fetched page text to the model without reading `quoteAllowed`. A `noai` / `noindex` page body could enter the prompt. Quote storage already dropped those quotes. | `apps/scout/src/backend/gemini.ts` `collectPages` at `3d35983`. | Remediated in `c101799`. A hit is included only when `fetchPage` returns text and `quoteAllowed` is true. A skipped fetch drops `rawContent` as well. |
| F-5 | medium | bundle scan | `bundleSecrets.test.ts` did not search the web bundle for `FIREBASE_SERVICE_ACCOUNT` or `GITHUB_DISPATCH_TOKEN`, so `pnpm scan:bundle` could pass with those names present. | `tools/test/bundleSecrets.test.ts` at `3d35983`. | Remediated in `066a8eb`. Both names are scanner patterns. `pnpm scan:bundle` passed. |
| L16 | low | SSRF | DNS is checked, then `fetch` resolves the hostname again. A rebinding name can point at a public address for the check and a private address for the connection. | `apps/scout/src/net/fetchPage.ts` `assertPublic` then `fetchImpl(url)`. | Documented only. |
| L17 | low | SSRF | The block list covers loopback, RFC1918, link-local, and IPv6 ULA. It does not cover CGNAT `100.64.0.0/10`, NAT64 `64:ff9b::/96`, or IPv6 multicast `ff00::/8`. Node's block list does map `::ffff:7f00:1` back to IPv4, so the dotted IPv4-mapped loopback form is already refused. | `apps/scout/src/net/ssrf.ts`. | Documented only. |
| L18 | low | admin override | The place-field allowlist uses `field in PlaceSchema.shape`. `in` walks the prototype, so names such as `toString` pass the membership test. `safeParse` is missing on that prototype object, so the request throws and the Worker returns a generic 500. It does not write the field. | `apps/api/src/routes/scoutAdmin.ts` override handler. | Documented only. |
| L19 | low | admin UI | The place drawer sets `<a href>` from `evidence.url`. `EvidenceSchema` uses `z.url()` with no http(s) restriction. Packet validation only allows http(s), and clients cannot write evidence, so a signed-in user cannot plant `javascript:` today. | `apps/web/src/admin/PlaceFacts.tsx`, `EvidenceSchema`. | Documented only. |

## Verdict

Open high: 0 · Open medium: 0 · Low (to Phase 6 backlog): 4

Reviewed at `3d35983` there was 1 high and 4 medium findings (F-1 through F-5). Each is fixed in its own commit with a test. Lows L16–L19 are listed above and copied to `docs/superpowers/backlog/phase-6-hardening.md`. Phase 0 items L1–L15 are unchanged.
