# Wayfare — AI Trip Planner: Design Spec

**Date:** 2026-09-20  
**Status:** Approved design (brainstorm complete). Next step: implementation plan per phase.  
**Working name:** "Wayfare" (placeholder).  
**Mockups:** `docs/superpowers/mockups/trip-planner-screens.canvas.tsx` (Cursor canvas; open beside chat or copy to `~/.cursor/projects/<workspace>/canvases/`).

---

## 0. Summary

A web app that turns a short, structured trip brief (destination, dates and flights, party, mobility, pace, budget, vacation-type mix, interests, must-visits, free-text) into a day-by-day itinerary with a map: ordered stops, travel legs, approximate time per stop, where to sleep each night, links, and exports (PDF, Google Docs, share link). Planning is performed by free-tier LLMs over a **verified menu of real places** built offline, so the model chooses rather than invents. Everything runs at **zero cost with no payment card anywhere**.

Business model: sign-in with Google is mandatory to plan; the first plan is free forever (one per account); editing, regenerating and additional plans require a monthly **Plus** subscription (metered).

### Hard constraints (non-negotiable)

1. **Zero cost, no card.** No service may require a payment method, even for a free tier. Consequences: Firebase Spark (no Cloud Functions), Cloudflare Workers free plan for the API, GitHub Actions for batch jobs, Gemini AI Studio + OpenRouter free models, open-data maps (no Google Maps Platform).
2. **Google sign-in required** to create or view one's own plans. Browsing (globe, search, pricing, public share pages) is open.
3. **Free = exactly one lifetime plan generation** per Google account. Any regeneration, edit or second plan is paid.
4. **Never show a plan that violates the brief.** A compliance gate blocks non-compliant plans; the free generation is not consumed on a gate failure.
5. **Never squeeze.** Pace is a time/energy budget; if something does not fit, drop the lowest-priority optional stop and say so.
6. **Only the owner can reach `/admin`.** Admin identity is a UID list hardcoded in deployed code (rules + Worker secret), never in data.
7. **TypeScript everywhere.**

---

## 1. Product definition, inputs & taxonomy

### 1.1 Destination model

| Kind | Geography | Scope options in the popover |
|---|---|---|
| `city` | center + radius | `city_only` · `city_plus_daytrips` (default radius 90 min drive; magic number) · `country` |
| `region` (e.g. Tuscany) | polygon / bbox + sub-areas | `region` |
| `country` | polygon + regions | `country` · one of its regions |
| `custom_list` (Plus) | several cities/regions in order | multi-city route |

Search resolution: destination registry (curated, multilingual names) → Nominatim (any place; returned type decides kind) → "not found, try the country". `city_only` fixes a single base and disables base changes; `country` and `custom_list` enable moving bases.

### 1.2 The Trip Brief (user inputs)

| Group | Fields | Notes |
|---|---|---|
| Destination | kind + scope (above) | picked from globe or search |
| Dates & anchors | start/end dates; arrival time + airport day 1; departure time + airport last day; output language | Flights are inputs only, never planned |
| Party | Solo · Couple · Family (kids' ages) · Friends (size) · Multi-generation · custom; accessibility needs | |
| Getting around | mobility preference (Rental car · Public transport · Walk + taxi · Mixed · custom) **and** `carRentalOk: boolean` | Consent to rent is separate from preference. Moving bases and rural stops require `carRentalOk` or a verified transit route |
| Budget | level € / €€ / €€€ (steers price tiers) **and** optional total budget (hard constraint) | Menu places carry `priceLevel` and, where known, `typicalCostPerPerson`; the gate checks summed estimates against the total |
| Pace & rhythm | Chill · Balanced · Packed; default day window; per-day start/end; `trustPlannerHours: boolean`; rest block on/off | See §3.5 for the pace model and hours precedence |
| Diet & accessibility | vegetarian, vegan, kosher, halal, gluten-free, allergies, limited walking, wheelchair, stroller, custom | Hard constraints |
| Where you sleep | Hotel · B&B · Airbnb · Agriturismo · custom; "one base" vs "happy to move" | |
| Kind of trip (vacation-type mix) | ordered picks from §1.3 top-level types + custom; first = *mostly*, second = *also* | Order feeds taxonomy weights |
| Interests | tags from destination-aware suggestions + free-typed custom entries | |
| In your words | three guided prompts: *This trip must have…* · *Please avoid…* · *A perfect day looks like…* | Replaces a blank textarea; one shared character budget |
| Must-visits | places that must appear; matched to menu or web-verified | |
| Avoid (Plus) | places already seen / unwanted | |

**Every category group is open-ended.** Each has an "Add your own" entry producing a first-class value visually marked *custom*. Custom entries count toward the same free-tier limits as built-ins. Validation: 2–40 chars, sanitised, treated as untrusted data in prompts. Custom entries are aggregated anonymously in the admin dashboard so frequent ones can be promoted to built-ins.

**Live readback.** Step 4 shows a read-only sentence — "How the planner will read this" — assembled from the structured fields. It is the human-readable form of the Trip Profile the engine builds (§3.2 step 2). Structured data is the source of truth; the sentence is never directly editable.

### 1.3 Activity taxonomy

Every menu place has one primary category and optional secondaries from a fixed tree:

```
food.{restaurant, street, dessert, cafe, market, wine, class}
culture.{museum, gallery, show, religious, architecture}
history.{landmark, ruin, castle, old_town}
nature.{park, hike, viewpoint, beach, lake, garden}
leisure.{spa, pool, relax}
shopping.{district, market, outlet, boutique}
nightlife.{bar, club, live_music}
family.{zoo, theme_park, playground, interactive}
adventure.{sport, tour, day_trip}
event.{festival, concert, match}
experience.{photo_spot, local_life, guided_tour}
logistics.{transfer, rest, checkin}        # scheduler-inserted, not selectable
```

Vacation types (Foodie, Wine & vineyards, Culture & museums, History & landmarks, Nature & outdoors, Beach & relax, Local life & hidden gems, Romance, Family fun, Adventure & sport, Wellness & spa, Shopping, Nightlife, Photo spots, Festivals & events) are **weight vectors over this tree**, which is what makes "a combination of several" work. Custom vacation types are mapped to weights by the LLM in step 2.

**Place record fields:** id, name (local form), coordinates, area, primary/secondary categories, typical dwell time + range, effort (1–3), indoor/outdoor, opening hours (OSM format), price level, typical cost, needs-booking + queue buffer, best time of day, kid-friendly, accessibility notes, website, Wikidata id, blurb, `fameScore`, `trendScore`, sources/evidence, seasonality, `customRequestCount`.

### 1.4 Free vs Plus

| | Free (one Google account, lifetime) | Plus (monthly; price TBD) |
|---|---|---|
| Plan generations | 1, ever | 3 new plans / month |
| Regenerate with changed inputs | — | 10 / month |
| Surgical edits (swap, move, remove, change stay area, restore version, apply suggestion) | — | Unlimited (0–1 AI calls each) |
| Refinement iterations (critic rounds) | 2 | 3 |
| Trip length | up to 7 nights | up to 21 nights |
| Destination | 1 city/region or up to 2 cities | any, incl. `custom_list` |
| Vacation types | 2 | any, weighted |
| Interest tags | 3 | unlimited |
| Must-visits | 3 | unlimited |
| Guided brief | 300 chars total | 1,500 chars |
| Avoid list, day-window presets, per-date override presets, custom events | — | ✓ |
| Editing individual day hours in the brief | ✓ | ✓ |
| Exports | PDF, share link | + Google Docs |
| Versions | v1 only | full history, restore, compare |
| Saved plans | 1 | many |

All numbers are admin-tunable (§7). A higher "Pro" tier is roadmap only.

---

## 2. System architecture

```
Browser (React + TS, Firebase Hosting)
  ├─ UI: globe, brief, plan view, exports (pdf-lib, Docs API)
  ├─ Scheduler (pure TS, shared package) — runs client-side
  └─ Firebase Auth (Google) · Firestore (own data, read)
Cloudflare Worker (free) — the only holder of secrets
  ├─ verify Firebase ID token (JWKS), App Check, rate limits
  ├─ quota transactions, tier checks, admin guards
  └─ proxies: LLM, search, geocode, routing; Stripe webhook
GitHub Actions (free cron) — scouting job, eval suite
Firestore (Spark) — all data (see §6)
External free APIs — Gemini (AI Studio key), OpenRouter :free, Tavily,
  Nominatim/Photon, Overpass, Wikidata/Wikipedia, OpenRouteService, OpenFreeMap tiles
```

### 2.1 Responsibilities

- **Browser** does everything that needs no secrets, including the deterministic **scheduler** (day layout). It also orchestrates plan generation step by step (each step = one short Worker call), persisting progress after every step so generation is resumable and streams progress.
- **Cloudflare Worker** is a thin stateless API: token verification (`iss`, `aud`, `exp`, signature, `email_verified`), App Check, per-IP/UID rate limits, quota transactions in Firestore, provider calls with secrets, Stripe webhook. Free plan: 100k req/day, ~10 ms CPU/request (network wait not counted). Writes to Firestore via REST with a least-privilege service account.
- **GitHub Actions** runs the batch **scouting job** (schedule + `repository_dispatch` from the Worker) and the monthly **model eval suite**. Never in the user's critical path.
- **Firebase**: Auth (Google provider only, email enumeration protection, authorized domains restricted), Firestore, Hosting (headers: CSP, HSTS, `frame-ancestors 'none'`).
- **Stripe**: Checkout + webhook → `subscriptions`, `users.tier`. Test mode in v1.

### 2.2 Providers behind interfaces

`LlmProvider`, `SearchProvider`, `GeocodeProvider`, `PoiProvider`, `RoutingProvider`, `TileProvider`. Each has primary + fallback so a 429 degrades instead of failing.

| Interface | Primary | Fallback | Free ceiling |
|---|---|---|---|
| LLM | model registry chains (§3.4) | — | per model |
| Web search | Gemini 2.5 Flash-Lite with Google Search grounding (retriever only) | Tavily | 500/day · 1,000/month |
| Geocoding | Nominatim (cached) | Photon | 1 req/s |
| POIs | Overpass + Wikidata | — | fair use |
| Routing / matrix | OpenRouteService (cached) | OSRM demo; straight-line ×1.4 labelled "estimated" | 2,000 req/day |
| Tiles | OpenFreeMap | MapTiler free | unlimited |

Google Places can later be added as a `PoiProvider` implementation if a card is ever added; nothing else changes.

### 2.3 Free-tier ceilings designed around

Firestore 50k reads + 20k writes/day, 1 GiB; Hosting 360 MB/day; Workers 100k req/day; ORS 2,000/day; Nominatim 1 rps; Gemini/OpenRouter per §3.4. The plan view loads **one** version document.

### 2.4 Repo shape

pnpm monorepo: `apps/web`, `apps/api` (Worker), `apps/scout` (batch), `packages/domain` (types, taxonomy, scheduler, lint, validation schemas, prompts, i18n registry), `packages/providers`.

### 2.5 i18n

One locale registry (`packages/domain/i18n/locales.ts`): `code`, native name, `dir`, `enabled`, formatting locale. The header dropdown, brief "output language", PDF fonts and the narrate step all read from it. Strings in per-locale JSON (react-i18next), English fallback, missing keys reported in CI. Direction follows the registry row (future RTL languages need no special-casing). UI language and plan output language are separate choices. Place names stay in local form.

---

## 3. Planning engine

**Approach (chosen): Retrieve → select → schedule → narrate, with bounded critique/refine iterations, gap search for user-specific asks, and a final compliance gate.** The LLM only makes choices from verified data and writes prose; arithmetic (minutes, distances, hours) is code.

### 3.1 Orchestration

Browser-driven pipeline; each step is a short Worker call or local code; progress persisted to `plans/{id}.generation` after every step (resumable; streams "Finding places… Laying out day 3…"). Target: 60–120 s for a scouted destination, +60–90 s with a Fast Pack.

### 3.2 Steps

1. **Menu ready?** Load pack slice for the destination scope; else run **Fast Pack** (§4.3).
2. **Brief → Trip Profile** *(LLM, JSON schema)*: taxonomy weights (ordered mix, custom types mapped), hard constraints (diet, accessibility, budget total, `carRentalOk`), explicit asks, must-visits resolved to menu IDs or flagged for gap search, energy budget from pace, hours policy.
3. **Gap search** *(conditional, 1–2 LLM calls)*: explicit asks / must-visits / custom entries without menu match → targeted web search → extraction → geocode → verification → join candidates and menu (`source: user_request`).
4. **Shortlist** *(code)*: score every menu place against the profile (category weights × fame/trend × constraints × season × budget) → top ~150–200 grouped by area.
5. **Selection & skeleton** *(LLM, IDs only)*: base area per night, areas per day, ~N candidate stops per day with priority rank and one-line "why". Unknown IDs → cheap repair call.
6. **Scheduler** *(code, browser)*: per day order stops using the ORS matrix; obey opening hours, that day's window, meals from food places in the right area, rest block (Chill/Balanced), check-in/out, arrival/departure anchors, drives between bases. Each stop gets one **approximate total** (dwell + queue + buffers; breakdown stored, not shown). Over budget → drop lowest-priority optional stop. Must-visits pinned; unfittable → precise reason.
7. **Critique** *(code lint + LLM)*: lint = must coverage, budgets, driving totals, missing meals, closed-that-day, monotony. Critic persona ("senior local guide reviewing a junior's itinerary") with rubric → change operations, each with a **severity** (major/minor).
8. **Refine** *(code, maybe 1 call)*: apply ops, re-schedule, re-lint. Loop to 7 only if a *major* issue remains; **max iterations per tier** (Free 2, Plus 3; `MAX_REFINE_ITERATIONS`). Leftover minor items become **Suggestions** on the plan (Plus can apply one-click).
9. **Compliance gate** *(code + LLM reviewer)*: deterministic checks (every must present; day windows; diet/accessibility; duration/destination; opening hours; total budget) then reviewer prompt returning `PASS` or violations quoting the exact constraint. Fail → one reserved repair pass → still fail → "Can't fit" screen with reasons and options; **free generation not consumed**.
10. **Narrate** *(1–2 LLM calls)*: per-day summary, per-stop why/tips/booking notes in the output language; streamed per day.
11. **Persist** as an immutable version; render.

Budget: 5–7 LLM calls per plan (scouted destination), 11–15 with Fast Pack.

### 3.3 Visible refinement log

Every change from steps 7–9 is recorded as `{round, change, why}` and shown live on the Generating screen and permanently under "How this plan was refined" on the plan. Later edits append to the same log.

### 3.4 Model routing & fallback chains

**Principle:** the chain is **data, not code**. A `ModelRegistry` (versioned JSON in repo, mirrored to `llmModels/*` for hot edits) lists each free model: provider, id, capabilities (JSON-schema output, context), *observed* limits, `enabled`, quality rank per task type. The router walks a chain in rank order, skipping models exhausted for today, and records the model used per step.

**Quota tracking:** per-model per-day counters in Cloudflare KV aligned to provider resets (Google: midnight Pacific; OpenRouter: midnight UTC). Daily-quota 429 → `exhausted-until-reset`; per-minute 429 → one backoff retry then skip. Observed RPD is learned from the first daily 429.

**Best-first (owner decision):** all plan-time reasoning and narration use the **Best chain** for Free and Plus alike. Only bulk scouting extraction/enrichment uses the **Extract chain** (admin toggle to change).

| Chain | Used by | Order (snapshot Sep 2026; verified against provider catalogues) |
|---|---|---|
| **Best** | steps 2, 5, 7, 9, 10 | Gemini 3.8 Flash → 3.7 Flash → 3.6 Flash → 3.5 Flash → 2.5 Pro → 2.5 Flash → Gemma 4 31B → OR `nvidia/nemotron-3-ultra-550b:free` → OR `nex-agi/nex-n2.5-pro:free` → OR `qwen/qwen3.8-27b:free` → OR `google/gemma-4-31b-it:free` → `openrouter/free` |
| **Extract** | scouting stages 3, 5; lint repair | Gemini 3.5 Flash-Lite → 3.1 Flash-Lite → 2.5 Flash-Lite → 2.0 Flash → Gemma 4 26B → OR `nvidia/nemotron-3-super-120b:free` → OR `inclusionai/ling-3.0-flash:free` → OR `nex-agi/nex-n2.5-mini:free` → `openrouter/free` |
| **Search** | scouting stage 3, gap search | Gemini 2.5 Flash-Lite + Google Search grounding (500/day; **retriever only** — the Best chain reads the pages) → Tavily (1,000/month) |

Facts that shaped this (verified 2026-09-20): Gemini 3.1 Pro Preview has **no free tier**; Google Search grounding is **not available** on the free tier for Gemini 3.x, but is free (500 RPD) on 2.5 Flash / 2.5 Flash-Lite; Google no longer publishes per-model free RPDs (community-observed: top Flash ≈ 20/day, Flash-Lite ≈ 500/day); OpenRouter `:free` = 50 req/day shared pool (1,000/day after a one-time $10 credit purchase — optional lever, not assumed), 20 rpm. Models lacking native JSON-schema output get prompt-enforced JSON + validator/repair.

**Ranking kept honest:** the golden-brief eval suite (§10) scores every registry model monthly and writes ranks back. New OpenRouter free models are auto-discovered from `/api/v1/models` as `unranked` and join a chain only after scoring.

**All exhausted:** plan → `queued` with everything done so far; plain message; auto-resume at the earliest provider reset.

### 3.5 Pace, hours and energy

- Pace sets three daily caps — active hours incl. transit / areas / walking km: **Chill ≈ 5 h / 2 / 5 km · Balanced ≈ 7 h / 4 / 8 km · Packed ≈ 9.5 h / 6 / 12 km** (magic numbers). No cap on stop *count*: a 10-minute stop costs 10 minutes.
- Each stop costs approximate total time × effort factor (1–3).
- **Hours precedence:** per-day values set by user → user's default window → planner-chosen (when `trustPlannerHours`), derived from pace, sunrise/sunset, opening hours and flights. Planner-chosen hours are marked "set by planner" in the plan and become editable on touch. Flight anchors always win on day 1 and the last day.
- Rest block (Chill 90 min, Balanced 60, Packed 0 — tunable) after lunch.
- Queue/entry buffers for famous sites (+30–60 min, "book ahead" flag) are internal to the approximate total.

### 3.6 Prompt engineering (first-class code)

- Schema-constrained JSON everywhere (Gemini `responseSchema`, OpenRouter structured outputs); unknown IDs rejected and repaired.
- Prompts in `packages/domain/prompts/` — versioned, with rubric + few-shot examples per pace.
- Separate critic and reviewer personas with explicit rubrics and a required "what would a local roll their eyes at" item.
- Reason in English, narrate in target language; low temperature for selection/critique/review, higher for narrative.
- User text and scraped pages are **untrusted data** in delimited blocks; model output can only be schema JSON; no tool use on untrusted content.

### 3.7 Edits (Plus) reuse the engine

Move/remove/reorder → scheduler only (0 calls). Replace-similar → one selection call over the shortlist. Change base area → re-skeleton that segment. Change inputs → full pipeline as a new version. Restore/apply-suggestion → data copy / scheduler only.

---

## 4. Scouting: building the menu (offline) and Fast Pack (online)

| | When | Output | User waits? |
|---|---|---|---|
| **Deep scout** (GitHub Actions) | seeding, weekly trend refresh, monthly OSM refresh, after a user's first plan for a new destination | full Destination Pack | never |
| **Plan generation** | on click | itinerary | 1–3 min, streamed |
| **Fast Pack** (inside generation) | destination has no pack | ~200–300 places focused on this brief | +60–90 s once |

### 4.1 Deep scout stages (example: Tuscany)

0. **Registry**: `destinations/{slug}` with status `empty | building | ready | stale`.
1. **Sub-areas** *(1 LLM call)*: towns/areas a visitor would consider, verified with Nominatim inside the bbox (Florence, Siena, Pisa, Lucca, San Gimignano, Chianti, Val d'Orcia…).
2. **Structured harvest** *(Overpass + Wikidata)*: museums, attractions, viewpoints, galleries, religious sites, historic, restaurants, cafés, gelaterie, bakeries, markets, wineries, parks, gardens, spas, beaches, stays. Coordinates, opening hours, website, cuisine, Wikidata description/photo/sitelink count. Drop nameless/tag-poor noise. ~500–2,000 candidates.
3. **Trend mining** *(search + Extract-chain LLM)*: per area × theme queries such as "viral TikTok restaurants Florence 2026", "TikTok famous gelato Florence", "Florence hidden gems reddit", "Val d'Orcia photo spots instagram". Fetch top ~5 pages/query → plain text → extraction JSON `{placeName, category, whyTrending, sourceUrl, platformMentioned: tiktok|instagram|reddit|blog|news, evidenceQuote, approxDate}`. ~40–60 queries, 10–20 extraction calls. **TikTok signal is obtained indirectly and legally**: TikTok's only API is research-only; we never scrape TikTok.
4. **Entity resolution**: fuzzy name + proximity match to stage-2 candidates; else Nominatim geocode; else discard. Nothing enters the menu without confirmed coordinates. Evidence stored per place.
5. **Enrichment & scoring** *(batched LLM, ~30 places/call)*: taxonomy, dwell, effort, indoor/outdoor, booking + queue buffer, best time, kid-friendly, accessibility, blurb. `fameScore` (Wikidata sitelinks, breadth of sources) and `trendScore` (distinct sources, platform weight with TikTok highest, recency decay).
6. **Stays**: per area, zones to sleep in with rationale + 2–3 example properties with website links; Booking/Airbnb search deep links (no booking API).
7. **Write**: `places/*`, `packs/{slug}` (compact prompt index; chunked above ~900 KB), `stayAreas/*`, `scoutRuns/*`.

Refresh: stage 3 weekly, stage 2 monthly; `stale` after 30 days. Cost ≈ 60–70 LLM calls + ~50 searches per destination.

### 4.2 What users see

Badges: **Trending now** (with platform icons and the evidence quote + source link on the card), **Classic must-see**, **Must-visit**, **Added by reviewer**, **Web-verified**.

### 4.3 Fast Pack

Miniature of stages 1–5 executed by the Worker/browser pipeline for the brief's scope and vacation types (≈ 6–10 searches, 2–3 extraction calls, 2–3 enrichment calls). Marks the destination `building` and dispatches a deep scout for next time. If < 60 places, the plan shows a "limited coverage" banner.

---

## 5. Screens & flow

See the canvas for interactive wireframes. Summary:

| # | Screen | Key decisions |
|---|---|---|
| 1 | **Home / Globe** | Interactive globe (drag/scroll to spin, idle rotation); search for city/region/country in any UI language with kind badges; flies to the destination then opens "Plan a trip to X?" with scope chips. Browsing needs no sign-in. |
| — | **Auth gate** | Every entry into planning passes `requireAuth(then)`: parks the intended destination, runs Google sign-in (popup desktop / redirect mobile), resumes. The redirect is UX; the Worker's token check is the security. |
| 2 | **Trip Brief** | 6 steps: Dates & flights → Who & how (party, getting around + car consent, budget level + optional total, diet, stay) → Pace (cards with plain meaning, default window, rest block, "let the planner set my hours") → **What you love** (centered single column: descriptive vacation-type cards with mostly/also order, type-anything interests + destination suggestions, three guided prompts, live readback) → Must-visits (matched: Menu / Web-verified) → Review (every dimension with Edit links; day-by-day editable hours or planner-chosen). Free limits shown as small meters on the field; unavailable options fade. |
| 3 | **Generating** | Human-readable steps with model/provider per step; live refinement log with reasons; resumable. |
| 4 | **Plan view** | Day tabs; map with numbered pins, route line, other days muted; timeline with time · name · **one approximate total** · category · badges · travel legs · website; "Tonight's base" card with rationale, one suggested stay, Booking/Airbnb links; version dropdown; "How this plan was refined"; "Suggestions you can apply" (Plus); Export PDF / Docs / Share; Edit (gated). Place card on pin click: what, why, evidence, hours, booking note, website. |
| 5 | **Can't fit** | Each violated constraint with the exact reason and options; free generation not consumed. |
| 6 | **Upgrade** | Free vs Plus; shown on Edit / Regenerate / New plan for Free users. |
| 7 | **My plans** | Status, versions (opens **Version history**: when, origin, what changed; View / Compare / Restore), shared state, monthly usage; queued plans show resume time. |
| 8 | **Admin** | §7. |
| — | Share page `/p/{id}` | Read-only plan view, no personal data, `noindex`, "Plan your own" via the gate. |
| — | Account | UI language, output language default, delete account + all plans. |

Design principles: one accent colour; calm spacing; limits visible but not nagging; every constraint the planner uses is visible somewhere in the brief; the readback makes precision checkable.

---

## 6. Data model (Firestore)

| Collection | Key | Holds | Written by |
|---|---|---|---|
| `users/{uid}` | UID | profile, locale, `tier`, `tierSource: none|stripe|admin`, `freeGenerationUsed`, timestamps | Worker |
| `users/{uid}/usage/{yyyy-mm}` | month | `plansCreated`, `regenerations`, `surgicalEdits` | Worker (transaction) |
| `plans/{planId}` | random | `ownerUid`, destination + scope, `status: drafting|generating|queued|ready|failed`, `currentVersionId`, `brief`, `generation` (step, model per step, refinement log, gate result) | Worker; client may write `brief` while `drafting` |
| `plans/{planId}/versions/{vId}` | ordinal | immutable itinerary (days → stops with placeId, times, approx total + breakdown, travel leg, why, tips, badges; bases; metrics; narrative per language), `origin: original|regenerate|edit|restore|apply-suggestion`, `restoredFrom`, summary | Worker |
| `shares/{shareId}` | 128-bit random | public copy of one version, itinerary only, `revokedAt` | Worker; public read |
| `destinations/{slug}` | slug | name(s), kind, geometry, areas, status, `lastScoutedAt`, counts | Scout |
| `places/{placeId}` (+ `evidence/*`) | stable hash | place record (§1.3) | Scout, Worker (gap search) |
| `packs/{slug}` (+ `chunks/*`) | slug | compact prompt index | Scout |
| `stayAreas/{slug}` | slug | zones, rationale, examples | Scout |
| `geocodeCache/*`, `routeCache/*` | hash | cached provider responses, TTL | Worker, Scout |
| `config/current`, `configVersions/{n}` | — | magic numbers, tier limits, chains, flags, `changedBy/At/reason` | Worker (admin) |
| `llmModels/{id}` | model id | registry entry | Worker (admin), eval job |
| `usageDaily/{provider}_{date}` | — | counters | Worker |
| `auditLog/*` | random | admin actions, tier changes, daily summary | Worker |
| `subscriptions/{uid}` | uid | Stripe ids, status, period end | Worker (webhook) |
| `scoutRuns/*` | random | logs, counts, errors | Scout |

**Versions are immutable and never deleted.** Restore copies the chosen version to a new one (`origin: restore`); costs nothing; not metered. Share links point at a version.

**Rules:** deny by default; owner reads own `users/plans/versions/usage`; public reads `destinations`, `places`, unrevoked `shares`; the only client write is `plans.brief` while `drafting`. Everything else Worker-only.

---

## 7. Admin dashboard (owner only)

Route `/admin`, lazy chunk served only after a verified admin token (hygiene; enforcement is §8).

| Panel | Capabilities |
|---|---|
| Magic numbers | pace caps, effort factors, day-window defaults, rest blocks, queue buffers, shortlist size, refinement iterations per tier, Fast Pack size, day-trip radius, energy constants — save as config version, revert |
| Tiers & limits | §1.4 table editable; Plus price placeholder; add tier |
| Model registry | reorder chains, enable/disable, live per-model usage vs observed limit, override limits, "scouting uses Best chain", eval scores |
| Users | search; tier override with reason (`tierSource: admin`, Stripe cannot undo); reset free generation; disable |
| Plans | recent plans, status, model per step, iterations, gate failures with the violated constraint; read-only open |
| Scouting | destination statuses, counts, "Scout now" / "Refresh trends", last run log |
| Quota & health | per-provider daily usage vs caps (Gemini, OpenRouter, search, ORS, Nominatim, Firestore, Worker), queued plans, error rate, median generation time |
| Feature flags | payments live/test, Docs export, Fast Pack, new-destination scouting, maintenance banner |
| Custom entries | anonymous aggregate of user-typed categories for promotion to built-ins |

All admin writes go through the Worker (validated, audited). Config hot-reloads within 60 s (KV cache).

---

## 8. Security

**Admin access — three independent locks:** (1) identity is the owner's Firebase **UID** with `email_verified`, never an email; (2) the UID list is **hardcoded in deployed code** — Firestore rules file and a Worker environment secret — no `admins` collection, no data path can grant admin; (3) every `/admin/*` request verifies the ID token, checks the UID against the secret list, and requires **fresh sign-in** (`auth_time` ≤ 15 min) for state changes. Owner account must use 2-step verification (hardware key/passkey).

| Area | Measure |
|---|---|
| Secrets | Worker secrets only; never in bundle, Firestore or repo; quarterly rotation; leaked-key runbook |
| Service account | Firestore read/write only |
| Firestore rules | deny by default; owner-scoped; Worker-only collections; emulator tests per collection × role |
| Quotas & tiers | Worker-only via Firestore transactions; client display is cosmetic; `tier` written only by webhook or admin |
| Free-tier abuse | Firebase App Check (reCAPTCHA v3) on all Worker calls; per-IP and per-UID rate limits; one generation per UID |
| Auth gate | Client redirect for UX; Worker rejects unauthenticated plan/generation requests; rules deny plan writes without `request.auth` |
| Prompt injection | user text and scraped pages as delimited untrusted data; schema-only outputs; no actions from model output; extracted names re-verified by geocoding |
| SSRF | fetch only http(s) URLs from the search provider; refuse private/loopback ranges; 2 MB / time limits; HTML/text only |
| Input validation | shared `zod` schemas; bounded lengths/enums/dates/coordinates |
| Share links | snapshot copy, 128-bit random id, no PII, revocable, `noindex` |
| Stripe | signature verification, idempotency, audited tier changes, test mode until flag flipped |
| Web | strict CSP, HSTS, `frame-ancestors 'none'`, CORS locked to app origin, no `eval` |
| Supply chain | Dependabot, `pnpm audit`, pinned lockfile, scoped Actions secrets; scout job has no Auth access |
| Privacy | logs carry UIDs/plan IDs only; audit log for admin actions; account + plans deletion; policy discloses free-tier prompts may be used by Google to improve models |

---

## 9. Exports & sharing

- **PDF** (all tiers): in-browser via `pdf-lib`; cover, per-day static map PNG (MapLibre canvas snapshot) + schedule table + base + why; appendix with links, booking notes, refinement log; Hebrew font + RTL.
- **Google Docs** (Plus): incremental `drive.file` scope; upload day-map PNGs to the user's Drive; build Doc via Docs API `batchUpdate` (headings, tables, inline images, links); store only the Doc id.
- **Share link** (all tiers): `shares/{id}` snapshot of a version → `/p/{id}` read-only view with "Plan your own" CTA; revocable; "Update shared link" re-snapshots.
- **Later**: "Open day in Google Maps" waypoint deep link; `.ics` export.

---

## 10. Error handling, observability, testing

| Failure | Behaviour |
|---|---|
| Provider 429/down | walk chain; all exhausted → `queued`, honest message, auto-resume |
| Invalid JSON / unknown IDs | validate → one repair call → next model |
| Gate fails after reserved repair | "Can't fit" with reasons; free generation not consumed |
| Routing/geocoding down | ORS → OSRM; Nominatim → Photon; else straight-line ×1.4 labelled "estimated" |
| Fast Pack < 60 places | proceed with "limited coverage" banner; flag deep scout |
| Tab closed mid-generation | resume from last persisted step |
| Firestore cap at 80% | admin alert; pause new generations with maintenance message before hard cap |

**Observability:** structured Worker logs (request id, uid, plan id, step, model, latency, tokens, outcome — never briefs/emails); `usageDaily` counters → admin gauges; daily summary to `auditLog`. Free tooling only.

**Testing:**
- `packages/domain`: unit + property-based tests for scheduler (hours, overrides, pace budgets, rest, pinning, drop-don't-squeeze, anchors), taxonomy mapping, compliance lint — invariants: no stop outside window, no day over budget, all musts present or reported.
- Providers: contract tests on recorded fixtures; nightly live smoke on a tiny quota slice.
- **Golden-brief eval suite**: ~20 fixed briefs (foodie couple Tuscany 6n; family with toddlers Rome 4n; solo photographer Kyoto; kosher family Lisbon; …) → lint score + rubric score per model, monthly, into `llmModels`; runs on prompt changes in CI with a small quota slice.
- Firestore rules: emulator tests, every collection × {anonymous, owner, other, admin}.
- Worker: integration tests with Firebase emulator (auth, quota transactions, admin guards, Stripe signatures).
- Web: component tests (brief limits, custom entries, readback, day hours); Playwright flows (globe → gate → brief → generating → plan → export); RTL snapshots.

---

## 11. Phased roadmap

| Phase | Goal | Contents | Done when |
|---|---|---|---|
| 0 · Foundations | zero-cost infra live | monorepo; Firebase Spark project; Worker with token verification; rules + emulator tests; CI; model registry + chain router + KV quota tracking; admin UID locks; locale registry | signed-in user calls a protected `/ping`; admin lock tests pass |
| 1 · Menu for one region | Tuscany pack | scout stages 1–7; `places/packs/stayAreas`; admin Scouting panel | 1,000+ verified places with scores and evidence |
| 2 · Plan engine | real Tuscany plan | Trip Brief (all steps); pipeline 1–11; scheduler; critic loop; gate; refinement log; Generating screen | golden briefs pass lint; a friend gets a half-decent plan |
| 3 · Plan view & map | looks like a product | globe home + search (cities/regions/countries) + auth gate; MapLibre plan map; timeline; place cards; bases; share link; PDF; EN + HE | you'd send the link to someone |
| 4 · Tiers & quotas | Free/Plus enforced | quota transactions; Upgrade screen; Stripe test mode + webhook; admin Users; Fast Pack | second Free plan blocked server-side; admin flips tiers |
| 5 · Plus editing | edits reuse the engine | surgical edits; regenerate with versions; version history + restore + compare; apply suggestions; Google Docs export | edit without full regeneration |
| 6 · Hardening | ready for strangers | App Check; rate limits; CSP; audit log; privacy + deletion; scheduled eval suite; more destinations seeded | §8 checklist green |

Each phase gets its own implementation plan (writing-plans). Nothing in a later phase blocks an earlier one.

---

## 12. Decisions log (from the brainstorm)

| Decision | Choice | Why |
|---|---|---|
| v1 success | runnable MVP for friends; monetization designed, payments in test mode | real plans for real regions, no legal/financial exposure yet |
| Lodging scope | plan picks base area per night + one concrete stay suggestion; flights are inputs | structure of multi-city trips depends on bases |
| Trend source | Google/web primary; TikTok signal indirectly via web mining; no scraping | TikTok has no legitimate API for this |
| Backend hosting | Firebase Spark + Cloudflare Workers free + GitHub Actions | hard "no card" rule |
| Maps | fully open-data stack (MapLibre, OSM, ORS, Wikidata, OpenFreeMap) | Google Maps Platform requires a card |
| Free entitlement | exactly one generation, ever; view/export forever | simplest to enforce |
| Paid editing | inputs-level regeneration + surgical edits + multiple plans, metered | free-model quotas are shared; "unlimited" is unsafe |
| Engine | retrieve → select → schedule → narrate, + web gap search, + bounded iterations | robust to weak models; arithmetic in code |
| Pace | time/energy budget, not stop count; hours user-configurable or planner-chosen | short stops are cheap; user control without burden |
| Buffers | single approximate total shown; breakdown internal | don't expose "40 min climbing" |
| Iterations | severity-gated, max 2 (Free) / 3 (Plus), leftovers → Suggestions | convergence + quota |
| Final gate | reviewer must PASS or plan is not shown; free generation not consumed on failure | never violate the brief |
| Models | best-first (Gemini 3.8 Flash) for all plan-time reasoning; Extract chain only for bulk scouting | quality first; protect scarce quota from mechanical work |
| Search | 2.5 Flash-Lite grounding as retriever, Best chain reads | grounding not free on 3.x |
| Admin | owner-only dashboard for magic numbers, registry, users, scouting, quotas | tune without deploys |
| Admin security | UID hardcoded in rules + Worker secret; fresh re-auth; no admin collection | no data path to privilege |
| Platform/lang | responsive web; EN + HE from day one via locale registry (dropdown) | more languages later cheaply |
| Exports | PDF, Google Docs (Plus), share link; map deep link later | |
| Readback | read-only mirror of structured fields | single source of truth |
| Brief budget | 300 chars total on Free across three guided prompts | precise, not an essay |
| Versions | immutable, never deleted, restore = copy, free | safe to experiment |
| Destinations | cities, regions, countries, custom lists; scopes in popover | "Tel Aviv" must work |

## 13. Open items (not blocking phase 0)

- Product name (placeholder "Wayfare").
- Plus price.
- Whether to make the optional one-time $10 OpenRouter credit purchase (raises the shared free pool from 50 to 1,000/day). Default: no.
- Exact set of ~30 seeded destinations.
- Compare-versions UI detail (phase 5).
