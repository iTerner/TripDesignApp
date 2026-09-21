# Phase 1 — Scouting Factory: Design Spec

**Date:** 2026-09-21  
**Status:** Approved design (brainstorm complete). Next: implementation plan (writing-plans).  
**Parent spec:** `docs/superpowers/specs/2026-09-20-trip-planner-design.md` — this document refines §4 (scouting), §6 (data model) and §7 (admin) for Phase 1 and supersedes them where they differ.  
**Depends on Phase 0 outputs:** `@wayfare/domain` (config schema, model registry, `chainFor`), `@wayfare/providers` (`ModelRouter`, Gemini/OpenRouter adapters), `apps/api` (`FirestoreClient`, admin guard), `infra/firebase` rules, `dev.bat`/`prod.bat` conventions.

---

## 1. Scope and "done when"

**Builds**
- `apps/scout` — the scouting CLI: seven stages, resumable via `work/<dest>/` files, idempotent Firestore writes.
- Two `IntelligenceBackend` implementations: `gemini` (ModelRouter + Tavily/grounding) and `agent` (work packets answered by a Cursor agent following a repo skill).
- The work-packet protocol and the repo skill `.cursor/skills/scout-destination/SKILL.md` (Appendix A).
- Entity resolution / dedupe (`resolvePlace()`), used by scouting now and by the planner's gap search in Phase 2.
- Firestore collections: `destinations` (queue), `places` (+ `evidence`), `pendingMerges`, `scoutRuns`, `reviewSessions`, `packs`, `stayAreas`.
- Admin panel: Scouting tab (queue, runs, manual Gemini run button), Places table with field-level editing, Review mode, Merge queue.
- `scout.bat` and `.github/workflows/scout.yml` (manual `workflow_dispatch` only — **no schedule**).

**Does not build**
- Fast Pack (Phase 4); ask index / embeddings / `placeStats` (Phase 2); scheduled or automatic runs (none, by decision); user-facing UI.

**Destinations in Phase 1:** Tuscany only. Other destinations are queue entries added later from the admin panel; the pipeline is destination-agnostic from day one.

**Done when**
1. `scout.bat tuscany --backend agent` (from Cursor) and `scout.bat tuscany --backend gemini` (PC or GitHub "Run") produce the same result shape; a re-run on the same destination changes nothing except refreshed trend evidence (idempotent).
2. Tuscany has ≥ 1,000 places with coordinates inside the region polygon, a taxonomy category, dwell time, hours or `unknown`, ≥ 1 source, fame and trend scores; ≥ 150 places carry trend evidence with a verified quote + URL.
3. The owner completes Review mode on 60 places (30 random active + 30 top-trend) with **≥ 85 % marked correct**.
4. Zero exact duplicates; the dedupe fixture (30 near-duplicate pairs) passes; ambiguous live pairs sit in `pendingMerges`, never in the menu.
5. Nothing runs without the owner starting it; secrets never leave `.env` / `.dev.vars` / Actions secrets.
6. **The Cursor agent path is complete and polished:** the skill exists; a fresh agent session given only "Scout Tuscany" completes a run end-to-end via packets; every packet type has a schema, an example and a rejection test; agent runs report progress like Gemini runs; the reviewed Tuscany run is an agent run.
7. The phase-end independent security review has no open high/medium findings.

---

## 2. Architecture

```
apps/scout (Node/TS CLI)
  queue ─► 1 areas ─► 2 harvest (OSM + Wikidata) ─► 3 trend mining ─► 4 resolve & dedupe
        ─► 5 enrich & score ─► 6 stays ─► 7 write pack ─► Firestore
  intelligence calls (1, 3, 5, 6) go through IntelligenceBackend:
     gemini: ModelRouter (Extract chain) + Tavily (raw content) → grounding fallback
     agent : work packets in work/<dest>/packets/ answered by a Cursor agent (skill)
  every backend answer → Zod validate → geocode → resolvePlace() → scoring → write
```

### 2.1 CLI

`pnpm scout <dest> [--backend gemini|agent] [--stage N] [--from N] [--dry-run] [--budget N] [--resume] [--status] [--report] [--dedupe]`

- Stages are modules `stages/01-areas.ts … 07-write.ts` sharing a `StageContext { dest, runId, backend, config, io, log }`. Each stage reads its inputs from and writes its outputs to `work/<dest>/<nn>-<name>.json`, so a run can restart at any stage and the agent backend has files to work with.
- `--dry-run` runs everything but writes to `work/<dest>/out/*.json` instead of Firestore.
- `--status` prints a one-screen board: stage, packets pending/answered/rejected, places so far, budget used, elapsed.
- `--report` prints and stores the Markdown run report (counts per area/category, top 20 trending, rejected extractions and why, dedupe decisions, budget).
- `--dedupe` re-runs the resolve ladder across a whole destination and reports candidate pairs into `pendingMerges`.
- `scout.bat` wraps the CLI in the same style as `dev.bat` (colours, flags, preflight, `.env` loading); `--backend gemini` requires the LLM keys in `.env`, `--backend agent` requires none.

### 2.2 Deterministic stages (identical under both backends)

| Stage | Code does |
|---|---|
| 2 Harvest | Overpass queries per area bbox (tourism, historic, amenity food/drink, shop bakery/pastry/ice_cream, leisure, natural, accommodation), Wikidata entity fetch for tagged ids (description, image P18 + licence, sitelink count); drop nameless / tag-poor nodes; cache raw responses in `work/` |
| 4 Resolve | `resolvePlace()` ladder (§4), Nominatim geocoding for names without OSM match (≤ 1 rps, identifying `User-Agent`, `geocodeCache`) |
| 5 Score | `fameScore` = f(sitelinks, distinct sources, OSM completeness); `trendScore` = f(distinct sources, platform weight tiktok 1.5 / instagram 1.2 / reddit 1.1 / blog 1.0 / news 1.0, recency decay 24 months, `quoteVerified`) — constants in `config.scout` |
| 7 Write | batched Firestore upserts keyed by `placeId`; base fields only; `effectivePlace()` for the pack; run summary to `scoutRuns` |

### 2.3 `IntelligenceBackend`

```ts
interface IntelligenceBackend {
  listAreas(input: AreasRequest): Promise<AreasResponse>;
  extractTrends(input: TrendsRequest): Promise<TrendsResponse>;   // includes search
  enrichBatch(input: EnrichRequest): Promise<EnrichResponse>;      // ≤ 30 places
  suggestStays(input: StaysRequest): Promise<StaysResponse>;
}
```
All request/response types are Zod schemas in `@wayfare/domain` (`scout/packets.ts`) and are shared verbatim by both backends and by the admin UI.

**`gemini` backend** — prompts from `packages/domain/prompts/scout/*.md`; `ModelRouter` with the **Extract** chain; search via `SearchProvider`: **Tavily with `include_raw_content: true` as primary** (page bodies in one call), Gemini 2.5 Flash-Lite Google-Search grounding as fallback (URLs → fetch → readability). This is the reverse of the parent spec's plan-time order, for scouting only, because the scout needs page bodies. Bounded by `--budget` (default 80 LLM calls, 60 searches).

**`agent` backend** — writes each call as `work/<dest>/packets/<type>-<n>.request.json` (system prompt, JSON schema, payload, `attempt`), waits for `<same>.response.json`, validates; invalid → `<same>.rejected.json` with per-item reasons; three rejections → the run pauses with a clear message. Provenance recorded on every place: `backend: "agent"`, `model: "cursor-agent"`, `packetIds[]`.

### 2.4 Manual-only execution

- `scout.bat` runs on the owner's PC on demand.
- `.github/workflows/scout.yml`: `workflow_dispatch` with required inputs `destinations` (comma-separated slugs) and `backend` (fixed `gemini`); **no `schedule:` block**. It reads the LLM keys and `FIREBASE_SERVICE_ACCOUNT` from Actions secrets.
- The admin Scouting tab's "Run with Gemini" button calls the Worker, which triggers the workflow via the GitHub API (fine-grained token, `actions:write` on this repo only) for the selected destination. Agent runs are started only from Cursor.

---

## 3. The Cursor agent backend

### 3.1 Owner experience
In Cursor: *"Scout Tuscany"* (or `/scout-destination tuscany`). The agent reads the skill, runs `pnpm scout tuscany --backend agent`, and loops: read the oldest `*.request.json` → do the work → write `*.response.json` → re-run the CLI (validates, advances, emits next packets). Progress is visible via `--status` and in the admin Scouting tab. At the end the agent runs `--report` and pastes the summary. Recommended: a dedicated chat; a full Tuscany run is ≈ 1 areas + ~40 trends + ~50 enrich + ~12 stays packets ≈ 100 agent turns.

### 3.2 Packet protocol (`work/<dest>/packets/`)

| Type | Request payload | Response (Zod) | Agent tools |
|---|---|---|---|
| `areas-1` | destination name, kind, bbox, hints | `{ areas: [{ name, lat, lng, why, kind: "town"\|"zone"\|"countryside" }] }` (8–16) | knowledge; CLI verifies each with Nominatim + bbox |
| `trends-<n>` | area, theme, 3–5 queries, `maxFindings` | `{ findings: [{ placeName, category, whyTrending, sourceUrl, platformMentioned, evidenceQuote, approxDate? }] }` | own web search + page reading; `sourceUrl` must be a page actually opened; `evidenceQuote` verbatim ≤ 240 chars |
| `enrich-<n>` | ≤ 30 candidates `{ id, name, lat, lng, osmTags, wikidataDesc? }` | `{ places: [{ id, primaryCategory, secondary[], dwellMin, dwellRange:[min,max], effort:1-3, indoor, needsBooking, queueBufferMin, bestTimeOfDay[], kidFriendly, accessibility, priceLevel, blurb }] }` | reasoning only; `id` must echo the request; categories from the taxonomy enum |
| `stays-<n>` | area, OSM accommodations, area facts | `{ zones: [{ name, rationale, exampleProperties: [{ name, website?, priceLevel }] }] }` (1–4 zones) | knowledge + optional web |

Rules enforced by the CLI for every response: schema-valid; ids echo; no coordinates invented by the agent (only `areas` carries coordinates, and they are re-verified); categories ∈ taxonomy; `evidenceQuote` checked against the fetched `sourceUrl` (substring after whitespace normalisation) → `quoteVerified`; unverified quotes are kept as evidence but excluded from `trendScore`. Rejections list exactly the failing items and reasons; the agent fixes only those.

### 3.3 Skill
The skill text is Appendix A. It is short, imperative, and contains: the start command, the packet loop, the hard rules, one good example per packet type, common mistakes, how to finish, and what to do when stuck.

### 3.4 Same guardrails as Gemini
The agent is an untrusted model: nothing it writes becomes a place without geocoding + `resolvePlace()` + validation; it never writes to Firestore (the CLI does, with the service account from `.env`); it never sees API keys.

---

## 4. Entity resolution and dedupe (`resolvePlace()`)

**Canonical id:** `placeId = sha1(normalizedName + "|" + geohash7)` where `normalizedName` = lowercase → strip diacritics → strip punctuation → drop generic prefixes/suffixes (`ristorante, trattoria, osteria, pizzeria, gelateria, pasticceria, bar, caffè, museo, chiesa, basilica, palazzo, the, il, la, le, i, gli`) → collapse whitespace.

**Match ladder** (stop at first hit):
1. exact `placeId`
2. shared external id: `osmId`, `wikidataId`, or normalised website domain
3. `normalizedName` equal **and** distance < 150 m
4. Jaro–Winkler(name) ≥ 0.88 **and** distance < 300 m **and** same category group
5. otherwise → new place

**Ambiguity:** JW in [0.80, 0.88) with distance < 300 m, or two candidates match → do not insert; write `pendingMerges` entry with score and reasons. Merging keeps one canonical document, unions `sources[]`/evidence, appends `aliases[]`, sets `mergedInto` on the loser (kept for old plan versions, never selected).

Used identically by scouting stage 4 and (Phase 2) the planner's gap search. `--dedupe` sweeps a destination and reports pairs.

---

## 5. Data model additions

| Collection | Fields |
|---|---|
| `destinations/{slug}` | `name`, `kind: city\|region\|country`, `geometry` (bbox + optional polygon ref), `queueOrder`, `status: queued\|building\|ready\|stale\|failed`, `requestedBy: admin`, `lastRunId`, `counts { scouted, userFound, trending, hidden }` |
| `places/{placeId}` | parent-spec fields + `source: scout\|user_request\|admin`, `backend: gemini\|agent`, `model`, `runId`, `packetIds[]`, `aliases[]`, `externalIds { osm?, wikidata?, website? }`, `verification { geocoded, sourcesCount, quoteVerified }`, `adminOverrides { [field]: { value, by, at, note? } }`, `status: active\|hidden\|tombstoned`, `mergedInto?`, `image? { url, licence, author }` |
| `places/{id}/evidence/{id}` | `url`, `platform`, `quote`, `quoteVerified`, `approxDate?`, `fetchedAt`, `backend`, `runId` |
| `pendingMerges/{id}` | `destSlug`, `placeIdA`, `placeIdB`, `score`, `reasons[]`, `status: open\|merged\|kept_both`, `resolvedBy?`, `resolvedAt?` |
| `scoutRuns/{runId}` | `destSlug`, `backend`, `startedBy: owner\|actions\|cursor`, `startedAt`, `finishedAt?`, per-stage `{ startedAt, finishedAt, counts }`, `budget { llmCalls, searches }`, `rejectedPackets[]`, `errors[]`, `reportMarkdown` |
| `reviewSessions/{id}` | `destSlug`, `runId`, `sample[]` (60 placeIds with `bucket: random\|topTrend`), `verdicts { [placeId]: "correct" \| "wrong:<reason>" \| "hide" }`, `accuracy`, `startedAt`, `completedAt?` |
| `packs/{slug}` | unchanged shape; built from **effective** values |
| `geocodeCache/{hash}` | unchanged |

**Override rule:** re-scouts write base fields only and never touch `adminOverrides` or `status`. `effectivePlace(place)` = base with each `adminOverrides[field].value` applied; used by the pack writer, the admin UI and (Phase 2) the planner. Hiding is `status: hidden` set by the admin; merged/tombstoned places are excluded from packs but retained.

---

## 6. Admin panel (Phase 1)

- **Scouting tab:** destination queue (add with kind, reorder, remove), status and counts per destination, run history with the Markdown report, **Run with Gemini** (manual; this destination only; triggers `workflow_dispatch`), live progress for the current run (agent or Gemini).
- **Places table:** server-paginated (50/page), filters (area, category, status, backend, has-trend, has-override), sort by fame/trend/updated; row → **edit drawer**: every enriched field editable (writes `adminOverrides` via Worker admin routes with fresh re-auth, audited), evidence list with links and `quoteVerified` badge, "hide with note", map dot.
- **Review mode:** sample = 30 random `active` + 30 top `trendScore` for a run; one card at a time (all fields, evidence, map); buttons Correct / Wrong (reason: closed · wrong category · wrong place · bad time · bad quote · other) / Hide; running accuracy; saved to `reviewSessions`; "Wrong" increments `timesFlagged` (field prepared for Phase 2's `placeStats`), "Hide" sets status.
- **Merge queue:** side-by-side pairs (names, distance, sources, evidence) → Merge (keep A / keep B) or Keep both.

All admin writes go through the Worker (`/admin/scout/*`, `/admin/places/*`, `/admin/merges/*`, `/admin/reviews/*`) — admin UID guard + fresh re-auth for state changes; audit-logged.

---

## 7. Security, cost and testing

**Security**
- Scout reads secrets from `.env` (local) or Actions secrets; the Cursor agent never sees keys; the CLI performs all Firestore writes.
- Web fetching: `http(s)` only, robots.txt respected, 2 MB / 10 s limits, private/loopback IP refusal (SSRF), identifying `User-Agent` with contact; Nominatim ≤ 1 rps with `geocodeCache`.
- Trend evidence: short quotes + URL only (never full pages); pages with `noai`/`noindex` meta are used for discovery only, no quote stored.
- Firestore rules: scout collections readable by the admin UID only (`places`/`destinations` public read stays as in the parent spec for the planner), client writes denied everywhere; Worker service account writes.
- GitHub token for `workflow_dispatch`: fine-grained, single repo, `actions:write` only, stored as a Worker secret `GITHUB_DISPATCH_TOKEN`.
- Phase-end independent security review (same protocol as Phase 0 Task 17).

**Cost controls**
- `--budget` (LLM calls, default 80) and search cap (default 60) per run; `config.scout` exposes all constants to the admin Magic-numbers panel.
- Firestore writes batched (≤ 500/commit); pre-run estimate aborts if the run would exceed 60 % of the remaining daily write quota.
- Tavily ≈ 50 searches/region → ~20 regions/month on the free tier; grounding fallback adds 500/day.

**Testing**
- Recorded fixtures: a 3-area Tuscany slice (~120 OSM places, Wikidata for 40, 6 saved web pages).
- Unit tests per stage; golden tests for every packet schema (valid/invalid); `resolvePlace()` fixture with 30 near-duplicate pairs and expected verdicts; `effectivePlace()` precedence; scoring formulas; run-report generation.
- Packet protocol tests: valid → ingested; invalid → `rejected.json` with reasons; echo-id mismatch; out-of-bbox area; unverified quote excluded from score; three rejections → pause.
- `--dry-run` end-to-end on the fixture with a fake backend (recorded answers).
- One live smoke: a single area with `--budget 6`, both backends.
- Rules emulator tests for the new collections; Worker tests for the new admin routes (guard, re-auth, override writes, audit).

---

## 8. Decisions log (Phase 1 brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Destinations | Tuscany only | find every pipeline bug on one region; others are a parameter |
| Quality judgement | admin Places table + Review mode, ≥ 85 % | measurable, and the owner's marks fix data as a side effect |
| Where it runs | `scout.bat` locally + GitHub manual Run | fast iteration; nothing automatic |
| Schedules | none | owner decision: everything is started manually on a given list |
| Admin corrections | full field editing via `adminOverrides` | owner decision; re-scouts must never undo manual work |
| Backends | hybrid: code owns the pipeline, `gemini` and `agent` brains | agent path uses the owner's Cursor plan and web tools instead of free quotas, without giving up verification and dedupe |
| Search for scouting | Tavily raw content primary, grounding fallback | one call returns page bodies; grounding returns snippets |
| Dedupe | canonical id + 5-rung ladder + merge queue | "same place twice" is the failure mode the owner called out |
| Seed list | queue mechanism now, list later from the admin panel | list is a market decision, not a build decision |

---

## Appendix A — `.cursor/skills/scout-destination/SKILL.md` (polished text)

```markdown
---
name: scout-destination
description: Build or refresh the verified place menu for one destination by answering scout work packets. Use when the owner says "scout <destination>", "refresh trends for <destination>", or runs /scout-destination.
---

# Scout a destination

You are the intelligence backend for the scouting pipeline. The pipeline (code) does the harvesting,
geocoding, de-duplication, scoring and all database writes. You do only the thinking it asks for,
one packet at a time. You never write to Firestore and you never see API keys.

## Start

1. Confirm the destination slug (e.g. `tuscany`). If it is not in the queue, say so and stop.
2. Run: `pnpm scout <slug> --backend agent`
   The CLI harvests places and then writes packets to `work/<slug>/packets/`.
3. Run `pnpm scout <slug> --status` whenever you want the progress board.

## The loop

Repeat until `--status` shows no pending packets and the stage is `done`:

1. Open the **oldest** `*.request.json` that has no `*.response.json`.
2. Read `instructions`, `schema` and `payload` in the file. Do exactly what `instructions` says.
3. Write your answer to the same path with `.response.json` instead of `.request.json`.
   The file must be valid JSON matching `schema` — nothing else, no comments, no markdown.
4. Run `pnpm scout <slug> --backend agent` again. The CLI validates your response and either
   advances (new packets appear) or writes `*.rejected.json` next to it.
5. If a packet was rejected, open the `.rejected.json`, fix **only** the listed items in your
   response file, and re-run. After three rejections of the same packet, stop and report.

You may process several `enrich-*` packets in parallel (they are independent). Never edit request
files, other packets' responses, or anything outside `work/<slug>/packets/`.

## Hard rules

- **Trends packets:** only report a place you found on a web page you actually opened. `sourceUrl`
  is that page. `evidenceQuote` is copied verbatim from it (≤ 240 characters). No paraphrasing.
  If your search finds nothing credible for a theme, return an empty `findings` array — that is a
  correct answer.
- **Never invent coordinates.** Only `areas` packets ask for coordinates, and the CLI re-verifies
  them. Everywhere else, leave location to the pipeline.
- **Echo ids exactly.** In `enrich` packets every `id` in your response must be one from the
  request, and every requested id must appear once.
- **Categories** come from the taxonomy enum listed in the packet. Pick the closest; never invent.
- **Be specific, be honest.** Prefer independent, local, currently-open places. Skip chains,
  closed places, and anything you cannot place in the right area. A shorter, correct answer beats a
  long, padded one.
- Language: English. Place names in their local form (Trattoria Sostanza, not a translation).

## Good answers (abridged)

`trends-07.response.json` (theme: dessert, area: Florence)
{
  "findings": [
    {
      "placeName": "Gelateria La Sorbettiera",
      "category": "food.dessert",
      "whyTrending": "Repeatedly named the best gelato in Oltrarno in 2026 posts; pistachio and
                      ricotta-fig flavours singled out",
      "sourceUrl": "https://example-blog.com/florence-gelato-2026",
      "platformMentioned": "tiktok",
      "evidenceQuote": "La Sorbettiera in Piazza Tasso is the one that went viral on TikTok this
                        spring, and it deserves it",
      "approxDate": "2026-05"
    }
  ]
}

`enrich-12.response.json` (one of 30)
{
  "id": "pl_3f9a…",
  "primaryCategory": "culture.museum",
  "secondary": ["history.landmark"],
  "dwellMin": 150,
  "dwellRange": [120, 210],
  "effort": 2,
  "indoor": true,
  "needsBooking": true,
  "queueBufferMin": 45,
  "bestTimeOfDay": ["morning"],
  "kidFriendly": "partial",
  "accessibility": "step-free entrance; lifts to all floors",
  "priceLevel": 2,
  "blurb": "The Medici's own collection: Botticelli, Leonardo and da Vinci's rooms in a
            16th-century office block turned world museum."
}

## Common mistakes (the CLI rejects these)

- A quote that is not on the cited page (`quote not found in cited page`).
- A well-known chain or a place outside the area's bbox (`coords outside bbox`).
- An id that was not in the request, or a missing id (`unknown id` / `missing id`).
- `dwellMin` of 10 for a major museum, or 180 for a gelato shop (`dwell implausible for category`).
- Markdown fences or comments in the JSON file (`invalid JSON`).

## Finish

1. Run `pnpm scout <slug> --report` and paste the summary to the owner: places written, trending
   with verified quotes, rejected packets and why, pending merges, budget.
2. Tell the owner to open Admin → Scouting → Review to judge the run.

## When stuck

Three rejections on one packet, a stage error in the CLI, or `work/` missing → stop, paste the
exact message, and wait. Do not work around the pipeline.
```
