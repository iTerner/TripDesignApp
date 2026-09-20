# TripDesignApp (working name: Wayfare)

An AI trip planner that turns a short, structured brief (destination, dates and flights, party, mobility and car-rental consent, pace, budget, vacation-type mix, interests, must-visits, and three guided free-text prompts) into a day-by-day itinerary with a map: ordered stops, travel legs, one approximate time per stop, where to sleep each night, links, and exports (PDF, Google Docs, share link). Planning is performed by free-tier LLMs choosing from a verified menu of real places that is built offline, so the model selects rather than invents. Everything runs at zero cost with no payment card anywhere.

## Status

- Design phase complete (2026-09-20). The approved design lives in [the design spec](docs/superpowers/specs/2026-09-20-trip-planner-design.md); interactive wireframes are in [the screen mockups](docs/superpowers/mockups/trip-planner-screens.canvas.tsx).
- No application code yet.
- Next step: the Phase 0 (Foundations) implementation plan.

## Hard constraints

From [spec §0](docs/superpowers/specs/2026-09-20-trip-planner-design.md#0-summary). Non-negotiable.

1. **Zero cost, no card.** No service may require a payment method, even for a free tier. Hence Firebase Spark (no Cloud Functions), Cloudflare Workers free plan for the API, GitHub Actions for batch jobs, Gemini AI Studio + OpenRouter free models, open-data maps (no Google Maps Platform).
2. **Google sign-in required** to create or view one's own plans. Browsing (globe, search, pricing, public share pages) is open.
3. **Free = exactly one lifetime plan generation** per Google account. Any regeneration, edit or second plan is paid.
4. **Never show a plan that violates the brief.** A compliance gate blocks non-compliant plans; the free generation is not consumed on a gate failure.
5. **Never squeeze.** Pace is a time/energy budget; if something does not fit, drop the lowest-priority optional stop and say so.
6. **Only the owner can reach `/admin`.** Admin identity is a UID list hardcoded in deployed code (rules + Worker secret), never in data.
7. **TypeScript everywhere.**

## Business model

- Sign-in with Google is mandatory to plan.
- One free plan generation per Google account, forever. The plan stays viewable and exportable.
- **Plus** is a monthly subscription (price TBD) that unlocks editing, regeneration and additional plans, all metered.

Key rows from [spec §1.4](docs/superpowers/specs/2026-09-20-trip-planner-design.md#14-free-vs-plus):

| | Free (one Google account, lifetime) | Plus (monthly) |
|---|---|---|
| Plan generations | 1, ever | 3 new plans / month |
| Regenerate with changed inputs | — | 10 / month |
| Surgical edits (swap, move, remove, change stay area, restore, apply suggestion) | — | Unlimited |
| Refinement iterations (critic rounds) | 2 | 3 |
| Trip length | up to 7 nights | up to 21 nights |
| Destination | 1 city/region or up to 2 cities | any, incl. multi-city custom list |
| Vacation types / interest tags / must-visits | 2 / 3 / 3 | any / unlimited / unlimited |
| Guided brief | 300 chars total | 1,500 chars |
| Exports | PDF, share link | + Google Docs |
| Versions | v1 only | full history, restore, compare |
| Saved plans | 1 | many |

All limits are admin-tunable. A higher "Pro" tier is roadmap only.

## Planned stack

| Layer | Choice |
|---|---|
| Web app | React + TypeScript on Firebase Hosting |
| Auth and data | Firebase Auth (Google provider only) + Firestore (Spark plan) |
| API | Cloudflare Workers free plan: the only holder of secrets; token verification, App Check, rate limits, quota transactions, provider proxies |
| Batch jobs | GitHub Actions (free cron): scouting job and monthly model eval suite |
| LLMs | Gemini AI Studio free tier + OpenRouter `:free` models, routed through a versioned model registry with fallback chains and per-model daily quota tracking |
| Web search | Gemini 2.5 Flash-Lite with Google Search grounding (retriever only) → Tavily fallback |
| Maps and places | MapLibre GL + OpenFreeMap tiles; OpenStreetMap/Overpass + Wikidata for POIs; Nominatim → Photon for geocoding; OpenRouteService for routing (OSRM demo / straight-line estimate fallback) |
| Exports | pdf-lib (in browser), Google Docs API (Plus), share-link snapshots |
| Payments | Not in v1 (Plus granted manually by admin); Stripe planned for Phase 7 |
| Monorepo | pnpm workspaces, TypeScript everywhere |

Why no Google Maps Platform: it requires a payment card, which violates the first hard constraint. The map stack is fully open data. Google Places could later be added as a `PoiProvider` implementation behind the existing interface if a card is ever added; nothing else would change.

## How it works

### Planning pipeline

Summary of [spec §3.2](docs/superpowers/specs/2026-09-20-trip-planner-design.md#32-steps). The LLM only chooses from verified data and writes prose; arithmetic (minutes, distances, hours) is code. The browser drives the pipeline step by step, persisting progress after each step so generation is resumable and streams progress.

1. **Menu ready?** Load the destination pack; if none exists, run a Fast Pack (200–300 places focused on this brief).
2. **Brief → Trip Profile** (LLM, JSON schema): taxonomy weights, hard constraints, explicit asks, must-visits resolved to menu IDs, energy budget, hours policy.
3. **Gap search** (conditional): web search, extraction, geocoding and verification for asks that have no menu match.
4. **Shortlist** (code): score every menu place against the profile; keep the top ~150–200 grouped by area.
5. **Selection and skeleton** (LLM, IDs only): base area per night, areas per day, candidate stops with priority and a one-line "why".
6. **Scheduler** (code, browser): order stops using a routing matrix; obey opening hours, day windows, meals, rest blocks, check-in/out and flight anchors; over budget → drop the lowest-priority optional stop.
7. **Critique → Refine** (lint + LLM critic, bounded iterations: Free 2, Plus 3): severity-rated change operations; leftover minor items become Suggestions.
8. **Compliance gate** (code + LLM reviewer) → **Narrate** (per-day summaries and per-stop tips in the output language) → **Persist** as an immutable version.

Budget: 5–7 LLM calls per plan for a scouted destination, 11–15 with a Fast Pack. Every refinement change is recorded and shown on the plan under "How this plan was refined".

### Scouting factory

Summary of [spec §4.1](docs/superpowers/specs/2026-09-20-trip-planner-design.md#41-deep-scout-stages-example-tuscany). Runs offline on GitHub Actions; never in the user's critical path.

1. **Sub-areas** (1 LLM call): towns/areas a visitor would consider, verified with Nominatim inside the destination bbox.
2. **Structured harvest** (Overpass + Wikidata): museums, attractions, restaurants, markets, wineries, parks, beaches, stays, with coordinates, opening hours, websites; ~500–2,000 candidates.
3. **Trend mining** (search + Extract-chain LLM): per area × theme queries; fetch pages, extract `{placeName, whyTrending, sourceUrl, platform, evidenceQuote}`. TikTok signal is obtained indirectly from the web; TikTok is never scraped.
4. **Entity resolution**: fuzzy name + proximity match to harvested candidates, else geocode, else discard. Nothing enters the menu without confirmed coordinates.
5. **Enrichment and scoring** (batched LLM): taxonomy, dwell time, effort, booking buffers, accessibility, blurb, `fameScore`, `trendScore`.
6. **Stays**: zones to sleep in per area with rationale and example properties.
7. **Write** `places/*`, `packs/{slug}`, `stayAreas/*`, `scoutRuns/*`. Trends refresh weekly, OSM data monthly; ~60–70 LLM calls per destination.

## Repository layout

Current files:

```
README.md
docs/superpowers/specs/2026-09-20-trip-planner-design.md      design spec (source of truth)
docs/superpowers/mockups/trip-planner-screens.canvas.tsx      screen mockups (Cursor Canvas)
```

Planned pnpm monorepo shape, from [spec §2.4](docs/superpowers/specs/2026-09-20-trip-planner-design.md#24-repo-shape):

```
apps/web            React + TS web app (globe, brief, plan view, exports)
apps/api            Cloudflare Worker (auth, quotas, provider proxies; payment webhook in Phase 7)
apps/scout          batch scouting job (GitHub Actions)
packages/domain     types, taxonomy, scheduler, lint, validation schemas, prompts, i18n registry
packages/providers  LlmProvider, SearchProvider, GeocodeProvider, PoiProvider, RoutingProvider, TileProvider
```

## Viewing the mockups

`docs/superpowers/mockups/trip-planner-screens.canvas.tsx` is a Cursor Canvas (a live React app that opens beside the chat). To view it, copy the file into your Cursor canvases folder and open it from there:

- macOS / Linux: `~/.cursor/projects/<workspace>/canvases/`
- Windows: `%USERPROFILE%\.cursor\projects\<workspace>\canvases\`

The canvas contains eight screens:

1. Home / Globe
2. Trip Brief
3. Generating
4. Plan view
5. Can't fit
6. Upgrade
7. My plans
8. Admin

## Roadmap

From [spec §11](docs/superpowers/specs/2026-09-20-trip-planner-design.md#11-phased-roadmap). Each phase gets its own implementation plan; nothing in a later phase blocks an earlier one.

| Phase | Goal | Done when |
|---|---|---|
| 0 · Foundations | zero-cost infra live | a signed-in user calls a protected `/ping`; admin lock tests pass |
| 1 · Menu for one region | Tuscany destination pack | 1,000+ verified places with scores and evidence |
| 2 · Plan engine | a real Tuscany plan | golden briefs pass lint; a friend gets a half-decent plan |
| 3 · Plan view & map | looks like a product | you'd send the link to someone |
| 4 · Tiers & quotas (admin-granted Plus) | Free/Plus enforced without payments | second Free plan blocked server-side; admin grants/revokes Plus; Plus request flow works |
| 5 · Plus editing | edits reuse the engine | edit without full regeneration |
| 6 · Hardening | ready for strangers | spec §8 security checklist and §13 legal gates (except G-L4) green |
| 7 · Payments | charge for Plus (Stripe) | a stranger can subscribe and cancel; counsel sign-off on commerce terms |

## Security highlights

From [spec §8](docs/superpowers/specs/2026-09-20-trip-planner-design.md#8-security).

- **Admin access, three independent locks:** identity is the owner's Firebase UID (with `email_verified`), never an email; the UID list is hardcoded in deployed code (Firestore rules file + Worker secret), with no `admins` collection or data path that can grant admin; every `/admin/*` request verifies the ID token, checks the UID, and requires fresh sign-in (`auth_time` ≤ 15 min) for state changes.
- **Free-tier abuse:** Firebase App Check (reCAPTCHA v3) on all Worker calls; per-IP and per-UID rate limits; one generation per UID enforced by Firestore transactions in the Worker.
- **Prompt injection:** user text and scraped pages are delimited untrusted data; model outputs are schema-only JSON; no actions are taken from model output; extracted place names are re-verified by geocoding.
- **SSRF:** fetch only http(s) URLs returned by the search provider; refuse private/loopback ranges; 2 MB and time limits; HTML/text only.
- **Firestore rules:** deny by default; owner-scoped reads; Worker-only collections; the only client write is `plans.brief` while drafting; emulator tests per collection × role.
- **No secrets in the client:** Worker secrets only, never in the bundle, Firestore or repo; quarterly rotation; least-privilege service account.
- **Web hardening:** strict CSP, HSTS, `frame-ancestors 'none'`, CORS locked to the app origin; share links are PII-free snapshots with 128-bit random ids, revocable, `noindex`.

## Open items

From [spec §15](docs/superpowers/specs/2026-09-20-trip-planner-design.md#15-open-items-not-blocking-phase-0). None block Phase 0.

- Product name (placeholder "Wayfare"); needs trademark clearance.
- Company entity and registration (needed before payments go live in Phase 7).
- Plus price (needed only for Phase 7).
- Firestore/Google Cloud data region (EU vs US); decide at project creation; affects the privacy policy.
- Nominatim exit plan (self-host vs commercial geocoder) before scale.
- Whether to make the optional one-time $10 OpenRouter credit purchase (raises the shared free pool from 50 to 1,000 requests/day). Default: no.
- Exact set of ~30 seeded destinations.
- Compare-versions UI detail (Phase 5).

## Links

- [Design spec](docs/superpowers/specs/2026-09-20-trip-planner-design.md)
  - [§0 Summary and hard constraints](docs/superpowers/specs/2026-09-20-trip-planner-design.md#0-summary)
  - [§1 Product definition, inputs and taxonomy](docs/superpowers/specs/2026-09-20-trip-planner-design.md#1-product-definition-inputs--taxonomy)
  - [§2 System architecture](docs/superpowers/specs/2026-09-20-trip-planner-design.md#2-system-architecture)
  - [§3 Planning engine](docs/superpowers/specs/2026-09-20-trip-planner-design.md#3-planning-engine)
  - [§4 Scouting](docs/superpowers/specs/2026-09-20-trip-planner-design.md#4-scouting-building-the-menu-offline-and-fast-pack-online)
  - [§5 Screens and flow](docs/superpowers/specs/2026-09-20-trip-planner-design.md#5-screens--flow)
  - [§6 Data model](docs/superpowers/specs/2026-09-20-trip-planner-design.md#6-data-model-firestore)
  - [§8 Security](docs/superpowers/specs/2026-09-20-trip-planner-design.md#8-security)
  - [§11 Phased roadmap](docs/superpowers/specs/2026-09-20-trip-planner-design.md#11-phased-roadmap)
  - [§12 Legal, rights and compliance](docs/superpowers/specs/2026-09-20-trip-planner-design.md#12-legal-rights--compliance)
  - [§13 Legal team and governance](docs/superpowers/specs/2026-09-20-trip-planner-design.md#13-legal-team--governance)
  - [§15 Open items](docs/superpowers/specs/2026-09-20-trip-planner-design.md#15-open-items-not-blocking-phase-0)
- [Screen mockups (Cursor Canvas)](docs/superpowers/mockups/trip-planner-screens.canvas.tsx)
