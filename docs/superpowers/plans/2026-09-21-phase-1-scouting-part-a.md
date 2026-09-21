# Phase 1 — Scouting Factory, Part A (pipeline, backends, skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `apps/scout` CLI so that `pnpm scout tuscany --backend agent --dry-run` and `--backend gemini --dry-run` run all seven scouting stages against the recorded Tuscany fixture (or live APIs) and write a verified, de-duplicated, scored place menu to `work/tuscany/out/*.json`, with both intelligence backends unit-tested, the work-packet protocol complete, and the `scout-destination` Cursor skill, `scout.bat` and manual-only GitHub workflow in place.

**Architecture:** Deterministic code owns the pipeline (harvest from Overpass/Wikidata, geocoding through Nominatim, entity resolution, scoring, writing); an `IntelligenceBackend` supplies only the judgement calls (areas, trend extraction, enrichment, stays). `GeminiBackend` uses the Phase 0 `ModelRouter` Extract chain plus Tavily/grounding search; `AgentBackend` writes JSON work packets to `work/<dest>/packets/` for a Cursor agent and validates its answers with the same Zod schemas; `FakeBackend` replays recorded answers for tests. Every stage reads and writes `work/<dest>/<nn>-<name>.json`, so runs are resumable and the CLI never blocks: with packets outstanding it exits with code 3 and the agent re-invokes it. Part A ends at a dry-run writer (`work/<dest>/out/`); Firestore writing, admin UI, rules and the security review are Part B.

**Tech Stack:** Node 22, pnpm 10, TypeScript 5.x strict (`exactOptionalPropertyTypes`), Biome, Vitest 3, Zod 4 (`z.toJSONSchema`), `commander`, `tsx`, `ngeohash`, `@turf/boolean-point-in-polygon`, `@turf/simplify`, `@turf/helpers`, `@mozilla/readability` + `linkedom`, Node global `fetch` (undici) with `AbortSignal.timeout`, `node:crypto` sha1, `node:dns` for SSRF checks. Existing: `@wayfare/domain` (config, model registry), `@wayfare/providers` (`GeminiProvider`, `OpenRouterProvider`, `ModelRouter`).

**Spec:** `docs/superpowers/specs/2026-09-21-phase-1-scouting-design.md` (all sections; §8 "Implementation clarifications" is numbered 9.x inside the file and is cited here as §8.x; Appendix A is the skill text). Parent spec `docs/superpowers/specs/2026-09-20-trip-planner-design.md` §1.3 (taxonomy), §4 (scouting), §6 (data model), §8 (security). Executors read all three.

## Global Constraints

- **Zero cost, no card anywhere** (parent §0 #1): Nominatim, Overpass, Wikidata, Wikimedia Commons public APIs; Tavily free tier; Gemini AI Studio free key; OpenRouter `:free`; GitHub Actions free minutes. Never enable billing or add a payment method.
- **Manual-only execution** (spec §2.4, §9): `scout.bat` on the owner's PC or `.github/workflows/scout.yml` with `workflow_dispatch` only. **No `schedule:` block anywhere.** Nothing runs without the owner starting it.
- **The Cursor agent never writes Firestore and never sees keys** (spec §3.4): the agent touches only `work/<slug>/packets/*.response.json`; the CLI validates, geocodes, de-duplicates and writes. Packet request files contain no secrets (tested).
- **Secrets only in `.env` (local), `apps/api/.dev.vars` (Worker dev) or GitHub Actions secrets** (spec §7, §8.7). Names reused from Phase 0, no new keys: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`. `--backend agent` needs none of them.
- **Nominatim ≤ 1 request/second with an identifying `User-Agent`** (spec §7, §8.1; parent §12.5); every result cached (`geocodeCache`). **Overpass sequential**, ≥ 1 s apart, primary `https://overpass-api.de/api/interpreter`, fallback `https://overpass.kumi.systems/api/interpreter`, `[out:json][timeout:60]`, raw responses cached in `work/<dest>/02-overpass/` (spec §8.2).
- **Web fetch rules** (spec §7; parent §8 SSRF): `http(s)` only; refuse private, loopback, link-local and unspecified IPs after DNS resolution; `robots.txt` honoured; **2 MB** body cap; **10 s** timeout; HTML/text only; pages with `noai`/`noindex` meta are discovery-only (no quote stored).
- **Evidence quotes ≤ 240 characters + URL only, never full pages** (spec §3.2, §7).
- **`placeId` is assigned once** (`sha1(normalizedName|geohash7)` at first insert) and later found only via the `resolvePlace()` ladder; re-runs never recompute ids (spec §8.4). Evidence id = `sha1(url|normalisedQuote)`.
- **Re-scouts write base fields only and never touch `adminOverrides` or `status`** (spec §5); `effectivePlace()` applies overrides for packs and UI.
- **Budget:** `--budget` LLM calls (default **80**), `scout.maxSearches` (default **60**), ≤ **2** searches per trends packet, ≤ **30** places per enrich packet (spec §2.3, §8.3).
- **Exit codes** (spec §8.5): `0` done · `1` error · `2` refused (lock, unknown destination, missing keys) · `3` `awaiting_packets` · `4` `paused_budget` · `5` `paused_rejections` (three rejections of one packet).
- **Formatting/lint:** LF line endings (`.gitattributes` `* text=auto eol=lf`; `*.bat` is CRLF), Biome 100-column, double quotes, semicolons. **Run `pnpm lint:fix` before `pnpm lint`** in every verification step. `exactOptionalPropertyTypes` is on: **omit optional keys instead of assigning `undefined`** (`...(x !== undefined ? { x } : {})`).
- **Tests live next to source** (`foo.test.ts` beside `foo.ts`); fixtures under `apps/scout/fixtures/`. Zod schemas for every packet use `z.strictObject` so unknown fields from a model are rejected.
- **Windows:** never edit source files through PowerShell string pipelines (they re-encode UTF-8); use the editor or Node scripts. Paths in code use `node:path` (`join`), never string concatenation with `\`.
- **Commit style:** Conventional Commits (`feat(scout):`, `feat(domain):`, `test:`, `chore:`, `docs:`, `ci:`). Commit after every task's last step. Stage `.cursor/` **only** for `.cursor/skills/**` (everything else under `.cursor/` stays ignored).
- **Package names:** `@wayfare/domain`, `@wayfare/providers`, `@wayfare/scout`. Product name is a placeholder; it appears only in the `User-Agent` string and file headers.
- **Dependency budget:** `apps/scout` runtime deps are exactly `commander`, `zod`, `ngeohash`, `@turf/boolean-point-in-polygon`, `@turf/simplify`, `@turf/helpers`, `@mozilla/readability`, `linkedom`, `@wayfare/domain`, `@wayfare/providers`. Jaro–Winkler, rate limiting, robots parsing and SSRF checks are implemented locally with tests.

---

## File Structure (end of Part A)

```
TripDesignApp/
├─ package.json                               # + "scout": "pnpm --filter @wayfare/scout scout --"
├─ .gitignore                                 # + work/ (except work/README.md), !.cursor/skills/**
├─ scout.bat                                  # Task 12 — wraps the CLI (colours, preflight, .env loading)
├─ .github/workflows/scout.yml                # Task 12 — workflow_dispatch only
├─ .cursor/skills/scout-destination/SKILL.md  # Task 12 — Appendix A verbatim
├─ work/README.md                             # Task 3 — what lives in work/<dest>/ (everything else ignored)
├─ packages/domain/
│  ├─ package.json                            # + exports "./prompts/*", "./package.json"
│  ├─ prompts/scout/{areas,trends,enrich,stays}.md   # Task 10 — shared by gemini (system prompt) and agent (instructions)
│  └─ src/
│     ├─ taxonomy/categories.ts(.test.ts)     # Task 1 — PlaceCategorySchema, groups, dwell bands, PlatformSchema
│     ├─ config/schema.ts(.test.ts)           # Task 1 — + ScoutConfigSchema / DEFAULT_SCOUT_CONFIG (config.scout)
│     └─ scout/
│        ├─ packets.ts(.test.ts)              # Task 2 — Areas/Trends/Enrich/Stays request+response, packet envelope
│        ├─ documents.ts(.test.ts)            # Task 2 — Destination, Place, Evidence, ScoutRun, PendingMerge, ReviewSession, effectivePlace()
│        ├─ validate.ts(.test.ts)             # Task 2 — validatePacketResponse() (Zod + semantic rules)
│        └─ jsonSchema.ts(.test.ts)           # Task 2 — packetJsonSchema(type)
└─ apps/scout/                                # @wayfare/scout
   ├─ package.json, tsconfig.json, vitest.config.ts
   ├─ destinations.seed.json                  # Task 3 — Part A queue (Tuscany); Part B reads destinations/{slug}
   ├─ fixtures/
   │  ├─ dedupe-pairs.json                    # Task 5 — 30 near-duplicate pairs with verdicts
   │  └─ tuscany-slice/                       # Tasks 6, 7, 11 — 3 areas: Florence, Siena, San Gimignano
   │     ├─ destination.json                  # 00-destination.json content (polygon + bbox)
   │     ├─ geocode-cache.json                # recorded Nominatim answers
   │     ├─ overpass/<area>-<group>.json      # recorded Overpass responses
   │     ├─ wikidata/<qid>.json               # processed WikidataInfo
   │     ├─ pages/<n>.json                    # 6 saved page texts
   │     └─ answers/                          # FakeBackend recorded answers
   └─ src/
      ├─ cli.ts                               # Task 3 (+ Task 11 wiring) — commander entry
      ├─ options.ts(.test.ts)                 # Task 3 — parseCliOptions()
      ├─ exit.ts                              # Task 3 — EXIT codes
      ├─ log.ts                               # Task 3 — ScoutLogger
      ├─ context.ts                           # Task 3 — StageContext, Stage, StageResult
      ├─ state.ts                             # Task 3 — RunStateSchema, newRunState()
      ├─ status.ts(.test.ts)                  # Task 3 — renderStatus()
      ├─ io/workdir.ts(.test.ts)              # Task 3 — WorkDir, FILES, DIRS
      ├─ util/hash.ts(.test.ts)               # Task 5 — sha1Hex, newPlaceId, evidenceId
      ├─ util/text.ts(.test.ts)               # Task 5 — normalizeQuote, slugify
      ├─ backend/types.ts                     # Task 3 — IntelligenceBackend, Answered, errors, BudgetTracker
      ├─ backend/fake.ts(.test.ts)            # Task 10
      ├─ backend/gemini.ts(.test.ts)          # Task 10
      ├─ backend/agent.ts(.test.ts)           # Task 10
      ├─ backend/prompts.ts(.test.ts)         # Task 10 — loadScoutPrompts()
      ├─ geo/rateLimiter.ts(.test.ts)         # Task 4
      ├─ geo/geocodeCache.ts(.test.ts)        # Task 4
      ├─ geo/polygon.ts(.test.ts)             # Task 4
      ├─ geo/nominatim.ts(.test.ts)           # Task 4
      ├─ geo/destination.ts                   # Task 4 — DestinationFileSchema, resolveDestinationFile()
      ├─ resolve/normalizeName.ts(.test.ts)   # Task 5
      ├─ resolve/jaroWinkler.ts(.test.ts)     # Task 5
      ├─ resolve/placeIndex.ts(.test.ts)      # Task 5
      ├─ resolve/resolvePlace.ts(.test.ts)    # Task 5 — ladder + dedupe fixture test
      ├─ harvest/tagGroups.ts(.test.ts)       # Task 6 — 8 groups, buildOverpassQuery
      ├─ harvest/overpassClient.ts(.test.ts)  # Task 6
      ├─ harvest/keepRule.ts(.test.ts)        # Task 6 — keepCandidate, guessCategory
      ├─ harvest/wikidata.ts(.test.ts)        # Task 6
      ├─ harvest/candidates.ts(.test.ts)      # Task 6 — toCandidate, rankCandidates, assignTier
      ├─ fixtures/seed.ts                     # Task 6 — seedWorkDirFromFixture()
      ├─ trends/matrix.ts(.test.ts)           # Task 7
      ├─ trends/search.ts(.test.ts)           # Task 7 — SearchProvider, TavilySearch, GroundingSearch, withFallback
      ├─ trends/safeFetch.ts(.test.ts)        # Task 7 — PageFetcher (SSRF, robots, size, time, cache)
      ├─ trends/extractText.ts(.test.ts)      # Task 7 — readability + noindex/noai
      ├─ trends/verifyQuote.ts(.test.ts)      # Task 7
      ├─ enrich/batches.ts(.test.ts)          # Task 8
      ├─ enrich/apply.ts(.test.ts)            # Task 8
      ├─ score/scores.ts(.test.ts)            # Task 8 — completeness, fameScore, trendScore
      ├─ stays/packets.ts(.test.ts)           # Task 9
      ├─ stages/collect.ts(.test.ts)          # Task 3 — collectAnswers()
      ├─ stages/01-areas.ts(.test.ts)         # Task 11
      ├─ stages/02-harvest.ts(.test.ts)       # Task 6
      ├─ stages/03-trends.ts(.test.ts)        # Task 7
      ├─ stages/04-resolve.ts(.test.ts)       # Task 11
      ├─ stages/05-enrich.ts(.test.ts)        # Task 8
      ├─ stages/06-stays.ts(.test.ts)         # Task 9
      ├─ stages/07-write.ts(.test.ts)         # Task 11 — DryRunWriter
      ├─ pipeline.ts(.test.ts)                # Task 11 — runPipeline()
      ├─ lock.ts(.test.ts)                    # Task 11
      ├─ report.ts(.test.ts)                  # Task 11
      ├─ dedupe.ts(.test.ts)                  # Task 11
      ├─ e2e/dryRun.test.ts                   # Task 11 — full fixture run with FakeBackend
      └─ e2e/agentProtocol.test.ts            # Task 12 — simulated agent answering packets
```

---

### Task 1: Taxonomy enum, category groups, dwell bands and `config.scout` (`@wayfare/domain`)

**Files:**
- Create: `packages/domain/src/taxonomy/categories.ts`, `packages/domain/src/taxonomy/categories.test.ts`
- Modify: `packages/domain/src/config/schema.ts` (add `ScoutConfigSchema`, `scout` key), `packages/domain/src/config/schema.test.ts` (append tests)
- Modify: `packages/domain/src/index.ts` (export taxonomy)

**Interfaces:**
- Consumes: existing `AppConfigSchema`, `DEFAULT_CONFIG` in `packages/domain/src/config/schema.ts`.
- Produces:
  ```ts
  const CATEGORY_GROUPS: readonly ["food","culture","history","nature","leisure","shopping","nightlife","family","adventure","event","experience","logistics"];
  type CategoryGroup = (typeof CATEGORY_GROUPS)[number];
  const CATEGORY_TREE: Record<CategoryGroup, readonly string[]>;        // leaves per group (parent §1.3)
  const PLACE_CATEGORIES: readonly string[];                            // "food.restaurant", ...
  const PlaceCategorySchema: z.ZodEnum;  type PlaceCategory = z.infer<typeof PlaceCategorySchema>;
  const SELECTABLE_CATEGORIES: readonly PlaceCategory[];                // all except logistics.*
  function categoryGroup(cat: PlaceCategory): CategoryGroup;
  type DwellBands = Record<string, readonly [number, number]>;          // key = group or full category
  const DEFAULT_DWELL_BANDS: DwellBands;
  function dwellBandFor(cat: PlaceCategory, bands?: DwellBands): readonly [number, number];
  const PlatformSchema = z.enum(["tiktok","instagram","reddit","blog","news"]); type Platform;
  const ScoutConfigSchema; type ScoutConfig; const DEFAULT_SCOUT_CONFIG: ScoutConfig;   // AppConfig.scout
  ```
  `ScoutConfig` field names (used verbatim by every later task): `areaRadiusKm.{town,zone,countryside}`, `cityRadiusKm`, `areasCount.{min,max}`, `areaCoordsMaxDriftKm`, `maxCandidates`, `budgetLlmCalls`, `maxSearches`, `searchesPerPacket`, `searchMaxResults`, `extractMaxChars`, `enrichBatchSize`, `themes[].{id,queries}`, `tierThemes.{tier2,tier3}`, `tierRules.{tier1,tier2}.{minSitelinks,minCandidates}`, `maxFindingsPerPacket`, `platformWeights.{tiktok,instagram,reddit,blog,news}`, `recencyMonths`, `trendScale`, `unknownDateRecency`, `fame.{sitelinksCoef,sourcesCoef,sourcesCap,completenessCoef}`, `jaroWinkler.{match,ambiguous}`, `matchDistanceM.{sameName,fuzzy}`, `quoteMaxChars`, `fetch.{maxBytes,timeoutMs,userAgent}`, `nominatim.{baseUrl,minIntervalMs}`, `overpass.{endpoints,minIntervalMs,timeoutSec}`, `polygon.{simplifyAboveBytes,simplifyTolerance}`, `lockStaleHours`, `maxRejectionsPerPacket`, `dwellBands`, `firestore.{batchSize,dailyWriteQuota,maxQuotaFraction}`.

- [ ] **Step 1: Write the failing taxonomy tests**

`packages/domain/src/taxonomy/categories.test.ts`:
```ts
import {
  CATEGORY_GROUPS,
  DEFAULT_DWELL_BANDS,
  PLACE_CATEGORIES,
  PlaceCategorySchema,
  PlatformSchema,
  SELECTABLE_CATEGORIES,
  categoryGroup,
  dwellBandFor,
} from "./categories";

test("the tree from parent spec §1.3 is flattened to group.leaf", () => {
  expect(PLACE_CATEGORIES).toContain("food.dessert");
  expect(PLACE_CATEGORIES).toContain("culture.museum");
  expect(PLACE_CATEGORIES).toContain("logistics.checkin");
  expect(PLACE_CATEGORIES).toHaveLength(55);
  expect(CATEGORY_GROUPS).toHaveLength(12);
});

test("schema accepts leaves and rejects invented categories", () => {
  expect(PlaceCategorySchema.parse("nature.viewpoint")).toBe("nature.viewpoint");
  expect(() => PlaceCategorySchema.parse("food.gelato")).toThrow();
  expect(() => PlaceCategorySchema.parse("food")).toThrow();
});

test("logistics.* is scheduler-inserted and not selectable", () => {
  expect(SELECTABLE_CATEGORIES.some((c) => c.startsWith("logistics."))).toBe(false);
  expect(SELECTABLE_CATEGORIES).toHaveLength(52);
});

test("categoryGroup returns the prefix", () => {
  expect(categoryGroup("history.castle")).toBe("history");
});

test("dwell bands: category override beats the group band (spec §8.8 examples)", () => {
  expect(dwellBandFor("food.dessert")).toEqual([10, 40]);
  expect(dwellBandFor("culture.museum")).toEqual([60, 240]);
  expect(dwellBandFor("food.restaurant")).toEqual(DEFAULT_DWELL_BANDS.food);
  expect(dwellBandFor("nature.hike", { nature: [30, 60] })).toEqual([30, 60]);
});

test("platforms are the five from spec §2.2", () => {
  expect(PlatformSchema.options).toEqual(["tiktok", "instagram", "reddit", "blog", "news"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wayfare/domain test`
Expected: FAIL — `Cannot find module './categories'`.

- [ ] **Step 3: Implement the taxonomy module**

`packages/domain/src/taxonomy/categories.ts`:
```ts
import { z } from "zod";

/** Parent spec §1.3 — the fixed activity tree. Order is stable; never reorder (ids are stored). */
export const CATEGORY_GROUPS = [
  "food",
  "culture",
  "history",
  "nature",
  "leisure",
  "shopping",
  "nightlife",
  "family",
  "adventure",
  "event",
  "experience",
  "logistics",
] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];
export const CategoryGroupSchema = z.enum(CATEGORY_GROUPS);

export const CATEGORY_TREE: Record<CategoryGroup, readonly string[]> = {
  food: ["restaurant", "street", "dessert", "cafe", "market", "wine", "class"],
  culture: ["museum", "gallery", "show", "religious", "architecture"],
  history: ["landmark", "ruin", "castle", "old_town"],
  nature: ["park", "hike", "viewpoint", "beach", "lake", "garden"],
  leisure: ["spa", "pool", "relax"],
  shopping: ["district", "market", "outlet", "boutique"],
  nightlife: ["bar", "club", "live_music"],
  family: ["zoo", "theme_park", "playground", "interactive"],
  adventure: ["sport", "tour", "day_trip"],
  event: ["festival", "concert", "match"],
  experience: ["photo_spot", "local_life", "guided_tour"],
  logistics: ["transfer", "rest", "checkin"],
};

function flatten(): [string, ...string[]] {
  const out: string[] = [];
  for (const group of CATEGORY_GROUPS) {
    for (const leaf of CATEGORY_TREE[group]) out.push(`${group}.${leaf}`);
  }
  return out as [string, ...string[]];
}

export const PLACE_CATEGORIES: readonly string[] = flatten();
export const PlaceCategorySchema = z.enum(flatten());
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

/** Everything a model may pick. logistics.* is inserted by the scheduler only. */
export const SELECTABLE_CATEGORIES: readonly PlaceCategory[] = PlaceCategorySchema.options.filter(
  (c) => !c.startsWith("logistics."),
);

export function categoryGroup(cat: PlaceCategory): CategoryGroup {
  return cat.slice(0, cat.indexOf(".")) as CategoryGroup;
}

/** Dwell-minute sanity bands (spec §8.8). Key = group or full category; category wins. */
export type DwellBands = Record<string, readonly [number, number]>;

export const DEFAULT_DWELL_BANDS: DwellBands = {
  food: [30, 180],
  "food.dessert": [10, 40],
  "food.street": [10, 45],
  "food.cafe": [15, 90],
  "food.market": [20, 120],
  "food.class": [90, 300],
  culture: [30, 240],
  "culture.museum": [60, 240],
  "culture.show": [60, 240],
  history: [20, 180],
  "history.old_town": [60, 300],
  nature: [20, 480],
  "nature.viewpoint": [10, 60],
  leisure: [45, 360],
  shopping: [20, 240],
  nightlife: [45, 300],
  family: [45, 480],
  adventure: [60, 600],
  event: [60, 360],
  experience: [15, 300],
  "experience.photo_spot": [10, 45],
  logistics: [5, 120],
};

export function dwellBandFor(
  cat: PlaceCategory,
  bands: DwellBands = DEFAULT_DWELL_BANDS,
): readonly [number, number] {
  return bands[cat] ?? bands[categoryGroup(cat)] ?? DEFAULT_DWELL_BANDS[categoryGroup(cat)] ?? [5, 600];
}

/** Where a trend mention was seen (spec §2.2). Names are nominative use only. */
export const PlatformSchema = z.enum(["tiktok", "instagram", "reddit", "blog", "news"]);
export type Platform = z.infer<typeof PlatformSchema>;
```

- [ ] **Step 4: Failing tests for `config.scout`**

Append to `packages/domain/src/config/schema.test.ts`:
```ts
import { DEFAULT_SCOUT_CONFIG, ScoutConfigSchema } from "./schema";

test("config.scout carries the spec §8 constants", () => {
  const s = DEFAULT_CONFIG.scout;
  expect(s.areaRadiusKm).toEqual({ town: 3, zone: 1.5, countryside: 10 });
  expect(s.cityRadiusKm).toBe(12);
  expect(s.maxCandidates).toBe(1500);
  expect(s.budgetLlmCalls).toBe(80);
  expect(s.maxSearches).toBe(60);
  expect(s.searchesPerPacket).toBe(2);
  expect(s.enrichBatchSize).toBe(30);
  expect(s.themes.map((t) => t.id)).toEqual([
    "food", "dessert", "cafe_breakfast", "wine", "viewpoint_photo", "hidden_gems",
    "culture", "nightlife", "shopping", "family", "nature_active",
  ]);
  for (const t of s.themes) expect(t.queries).toHaveLength(2);
  expect(s.tierThemes.tier2).toEqual(["food", "dessert", "hidden_gems", "viewpoint_photo", "culture"]);
  expect(s.tierThemes.tier3).toEqual(["food", "hidden_gems"]);
  expect(s.platformWeights).toEqual({ tiktok: 1.5, instagram: 1.2, reddit: 1.1, blog: 1, news: 1 });
  expect(s.recencyMonths).toBe(24);
  expect(s.jaroWinkler).toEqual({ match: 0.88, ambiguous: 0.8 });
  expect(s.matchDistanceM).toEqual({ sameName: 150, fuzzy: 300 });
  expect(s.quoteMaxChars).toBe(240);
  expect(s.fetch.maxBytes).toBe(2_000_000);
  expect(s.fetch.timeoutMs).toBe(10_000);
  expect(s.fetch.userAgent).toMatch(/^WayfareScout\//);
  expect(s.nominatim.minIntervalMs).toBe(1000);
  expect(s.overpass.endpoints[0]).toBe("https://overpass-api.de/api/interpreter");
  expect(s.lockStaleHours).toBe(2);
  expect(s.maxRejectionsPerPacket).toBe(3);
  expect(s.dwellBands["food.dessert"]).toEqual([10, 40]);
});

test("scout config rejects a theme without exactly two query templates", () => {
  const bad = { ...DEFAULT_SCOUT_CONFIG, themes: [{ id: "food", queries: ["one"] }] };
  expect(() => ScoutConfigSchema.parse(bad)).toThrow();
});

test("scout config rejects unknown tier theme ids", () => {
  const bad = { ...DEFAULT_SCOUT_CONFIG, tierThemes: { tier2: ["nope"], tier3: ["food"] } };
  expect(() => ScoutConfigSchema.parse(bad)).toThrow(/unknown theme/);
});
```
(Add `DEFAULT_SCOUT_CONFIG, ScoutConfigSchema` to the existing import line instead of a second import if Biome complains about duplicate imports.)

- [ ] **Step 5: Add `ScoutConfigSchema` and `scout` to the app config**

In `packages/domain/src/config/schema.ts`, add after the imports:
```ts
import { DEFAULT_DWELL_BANDS } from "../taxonomy/categories";

const DwellBandsSchema = z.record(
  z.string(),
  z.tuple([z.number().int().min(0), z.number().int().positive()]),
);

const ThemeSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  /** Two query templates; `{area}` and `{year}` are substituted (spec §8.3). */
  queries: z.tuple([z.string().min(3), z.string().min(3)]),
});

const TierRuleSchema = z.object({
  minSitelinks: z.number().int().min(0),
  minCandidates: z.number().int().min(0),
});

export const ScoutConfigSchema = z
  .object({
    areaRadiusKm: z.object({
      town: z.number().positive(),
      zone: z.number().positive(),
      countryside: z.number().positive(),
    }),
    cityRadiusKm: z.number().positive(),
    areasCount: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
    /** Drop an area if Nominatim places it further than this from the model's coordinates. */
    areaCoordsMaxDriftKm: z.number().positive(),
    maxCandidates: z.number().int().positive(),
    budgetLlmCalls: z.number().int().positive(),
    maxSearches: z.number().int().min(0),
    searchesPerPacket: z.number().int().min(1),
    searchMaxResults: z.number().int().min(1).max(20),
    extractMaxChars: z.number().int().positive(),
    enrichBatchSize: z.number().int().min(1).max(30),
    themes: z.array(ThemeSchema).min(1),
    tierThemes: z.object({ tier2: z.array(z.string()), tier3: z.array(z.string()) }),
    tierRules: z.object({ tier1: TierRuleSchema, tier2: TierRuleSchema }),
    maxFindingsPerPacket: z.number().int().min(1).max(40),
    platformWeights: z.object({
      tiktok: z.number().min(0),
      instagram: z.number().min(0),
      reddit: z.number().min(0),
      blog: z.number().min(0),
      news: z.number().min(0),
    }),
    recencyMonths: z.number().int().positive(),
    trendScale: z.number().positive(),
    /** Recency factor used when a finding has no approxDate. */
    unknownDateRecency: z.number().min(0).max(1),
    fame: z.object({
      sitelinksCoef: z.number().min(0),
      sourcesCoef: z.number().min(0),
      sourcesCap: z.number().int().min(1),
      completenessCoef: z.number().min(0),
    }),
    jaroWinkler: z.object({ match: z.number().min(0).max(1), ambiguous: z.number().min(0).max(1) }),
    matchDistanceM: z.object({ sameName: z.number().positive(), fuzzy: z.number().positive() }),
    quoteMaxChars: z.number().int().positive(),
    fetch: z.object({
      maxBytes: z.number().int().positive(),
      timeoutMs: z.number().int().positive(),
      userAgent: z.string().min(10),
    }),
    nominatim: z.object({ baseUrl: z.url(), minIntervalMs: z.number().int().min(1000) }),
    overpass: z.object({
      endpoints: z.array(z.url()).min(1),
      minIntervalMs: z.number().int().min(1000),
      timeoutSec: z.number().int().positive(),
    }),
    polygon: z.object({
      simplifyAboveBytes: z.number().int().positive(),
      simplifyTolerance: z.number().positive(),
    }),
    lockStaleHours: z.number().positive(),
    maxRejectionsPerPacket: z.number().int().min(1),
    dwellBands: DwellBandsSchema,
    firestore: z.object({
      batchSize: z.number().int().min(1).max(500),
      dailyWriteQuota: z.number().int().positive(),
      maxQuotaFraction: z.number().min(0).max(1),
    }),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set(cfg.themes.map((t) => t.id));
    for (const [tier, list] of Object.entries(cfg.tierThemes)) {
      for (const id of list) {
        if (!ids.has(id)) {
          ctx.addIssue({ code: "custom", message: `unknown theme "${id}" in tierThemes.${tier}` });
        }
      }
    }
    if (cfg.areasCount.min > cfg.areasCount.max) {
      ctx.addIssue({ code: "custom", message: "areasCount.min must be <= areasCount.max" });
    }
  });
export type ScoutConfig = z.infer<typeof ScoutConfigSchema>;

/** Spec §2.2, §7, §8.1–§8.8 defaults; admin-tunable ("Scout" group of the Magic-numbers panel). */
export const DEFAULT_SCOUT_CONFIG: ScoutConfig = {
  areaRadiusKm: { town: 3, zone: 1.5, countryside: 10 },
  cityRadiusKm: 12,
  areasCount: { min: 8, max: 16 },
  areaCoordsMaxDriftKm: 20,
  maxCandidates: 1500,
  budgetLlmCalls: 80,
  maxSearches: 60,
  searchesPerPacket: 2,
  searchMaxResults: 8,
  extractMaxChars: 40_000,
  enrichBatchSize: 30,
  themes: [
    { id: "food", queries: ["best restaurants {area} {year}", "{area} restaurant TikTok viral"] },
    { id: "dessert", queries: ["best gelato {area} {year}", "{area} pastry TikTok viral"] },
    { id: "cafe_breakfast", queries: ["best cafe breakfast {area} {year}", "{area} coffee instagram"] },
    { id: "wine", queries: ["best wine tasting {area} {year}", "{area} winery visit reddit"] },
    { id: "viewpoint_photo", queries: ["{area} best photo spots {year}", "{area} viewpoint instagram"] },
    { id: "hidden_gems", queries: ["{area} hidden gems reddit", "{area} off the beaten path {year}"] },
    { id: "culture", queries: ["{area} museums worth visiting {year}", "{area} exhibition {year}"] },
    { id: "nightlife", queries: ["{area} best bars {year}", "{area} aperitivo TikTok"] },
    { id: "shopping", queries: ["{area} artisan shops {year}", "{area} market shopping guide"] },
    { id: "family", queries: ["{area} with kids {year}", "{area} family activities reddit"] },
    { id: "nature_active", queries: ["{area} hikes walks {year}", "{area} outdoor activities instagram"] },
  ],
  tierThemes: {
    tier2: ["food", "dessert", "hidden_gems", "viewpoint_photo", "culture"],
    tier3: ["food", "hidden_gems"],
  },
  tierRules: {
    tier1: { minSitelinks: 200, minCandidates: 150 },
    tier2: { minSitelinks: 80, minCandidates: 40 },
  },
  maxFindingsPerPacket: 12,
  platformWeights: { tiktok: 1.5, instagram: 1.2, reddit: 1.1, blog: 1, news: 1 },
  recencyMonths: 24,
  trendScale: 20,
  unknownDateRecency: 0.5,
  fame: { sitelinksCoef: 25, sourcesCoef: 8, sourcesCap: 5, completenessCoef: 20 },
  jaroWinkler: { match: 0.88, ambiguous: 0.8 },
  matchDistanceM: { sameName: 150, fuzzy: 300 },
  quoteMaxChars: 240,
  fetch: {
    maxBytes: 2_000_000,
    timeoutMs: 10_000,
    // Replace the contact clause with your real contact address before the first live run
    // (Nominatim usage policy requires a way to reach the operator).
    userAgent: "WayfareScout/0.1 (trip-planner place scouting; manual runs; contact: see repo README)",
  },
  nominatim: { baseUrl: "https://nominatim.openstreetmap.org", minIntervalMs: 1000 },
  overpass: {
    endpoints: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ],
    minIntervalMs: 1000,
    timeoutSec: 60,
  },
  polygon: { simplifyAboveBytes: 200_000, simplifyTolerance: 0.002 },
  lockStaleHours: 2,
  maxRejectionsPerPacket: 3,
  dwellBands: DEFAULT_DWELL_BANDS,
  firestore: { batchSize: 500, dailyWriteQuota: 20_000, maxQuotaFraction: 0.6 },
};
```
Then add `scout: ScoutConfigSchema,` as the last key of `AppConfigSchema` and `scout: DEFAULT_SCOUT_CONFIG,` as the last key of `DEFAULT_CONFIG`, and bump `version: 2` in `DEFAULT_CONFIG`.

Add to `packages/domain/src/index.ts`: `export * from "./taxonomy/categories";`

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/domain test && pnpm lint:fix && pnpm lint && pnpm typecheck`
Expected: all PASS (existing config tests still pass because `scout` was only added).

- [ ] **Step 7: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): place taxonomy enum, category groups, dwell bands and config.scout defaults"
```

---

### Task 2: Scout packet schemas, document schemas, `validatePacketResponse()` and JSON-schema export (`@wayfare/domain`)

**Files:**
- Create: `packages/domain/src/scout/packets.ts`, `packages/domain/src/scout/packets.test.ts`
- Create: `packages/domain/src/scout/documents.ts`, `packages/domain/src/scout/documents.test.ts`
- Create: `packages/domain/src/scout/validate.ts`, `packages/domain/src/scout/validate.test.ts`
- Create: `packages/domain/src/scout/jsonSchema.ts`, `packages/domain/src/scout/jsonSchema.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `PlaceCategorySchema`, `SELECTABLE_CATEGORIES`, `PlatformSchema`, `DwellBands`, `dwellBandFor` (Task 1).
- Produces (all Zod; types are `z.infer` with the same name minus `Schema`):
  ```ts
  LatLngSchema { lat, lng }                     BBoxSchema { south, west, north, east }
  DestinationKindSchema = "city"|"region"|"country"     AreaKindSchema = "town"|"zone"|"countryside"
  AreaTierSchema = 1|2|3                        BackendIdSchema = "gemini"|"agent"
  AreasRequestSchema { destination:{slug,name,kind}, bbox, hints:string[], minAreas, maxAreas }
  AreaSuggestionSchema { name, lat, lng, why, kind }       AreasResponseSchema { areas: AreaSuggestion[] (1..16) }
  TrendsRequestSchema { area:{name,lat,lng,kind,tier}, theme, queries:string[] (1..5), maxFindings, year }
  TrendFindingSchema { placeName, category, whyTrending, sourceUrl, platformMentioned, evidenceQuote(≤240), approxDate? }
  TrendsResponseSchema { findings: TrendFinding[] (0..40) }
  EnrichCandidateSchema { id, name, lat, lng, osmTags: Record<string,string>, wikidataDesc? }
  EnrichRequestSchema { candidates: EnrichCandidate[] (1..30), taxonomy: PlaceCategory[], dwellBands }
  EnrichedPlaceSchema { id, primaryCategory, secondary[], dwellMin, dwellRange:[min,max], effort:1|2|3, indoor, needsBooking, queueBufferMin, bestTimeOfDay[], kidFriendly:"yes"|"partial"|"no", accessibility, priceLevel:0..4, blurb }
  EnrichResponseSchema { places: EnrichedPlace[] (1..30) }
  StaysRequestSchema { area:{name,lat,lng,kind}, accommodations:{name,lat,lng,tourism,website?,stars?}[] (0..60), areaFacts:string[] }
  StayZoneSchema { name, rationale, exampleProperties:{name,website?,priceLevel}[] (1..5) }     StaysResponseSchema { zones: StayZone[] (1..4) }
  PacketTypeSchema = "areas"|"trends"|"enrich"|"stays"      PACKET_ID_PATTERN = /^(areas|trends|enrich|stays)-\d{1,4}$/     PacketIdSchema
  PACKET_SCHEMAS: Record<PacketType, { request: ZodType; response: ZodType }>
  PacketRequestFileSchema { packetId, type, attempt, instructions, schema: Record<string,unknown>, payload: unknown }
  RejectionReasonSchema { path, reason }        PacketRejectionSchema { packetId, attempts: { attempt, at, responseSha1, reasons[] }[] }
  // documents.ts
  DestinationGeometrySchema { bbox, center, radiusKm?, polygonRef? }   DestinationStatusSchema   DestinationSchema (§5)
  PlaceSourceSchema = "scout"|"user_request"|"admin"    PlaceStatusSchema = "active"|"hidden"|"tombstoned"|"unenriched"
  HoursStatusSchema = "known"|"unknown"      SourceRefSchema { kind:"osm"|"wikidata"|"web"|"llm"|"agent", ref }
  AdminOverrideSchema { value: unknown, by, at }   ExternalIdsSchema { osm?, wikidata?, website? }
  VerificationSchema { geocoded, sourcesCount, quoteVerified }   PlaceImageSchema { url, licence, author }
  PlaceSchema (§5 + parent §1.3 fields; see code)   EvidenceSchema   PendingMergeSchema   StageRunSchema   ScoutRunSchema   ReviewSessionSchema
  function effectivePlace(place: Place): Place
  // validate.ts
  type ValidationResult<T> = { ok: true; data: T } | { ok: false; reasons: RejectionReason[] }
  function validatePacketResponse(type: "areas", request: AreasRequest, raw: unknown): ValidationResult<AreasResponse>  // + overloads for the other three
  // jsonSchema.ts
  function packetJsonSchema(type: PacketType): Record<string, unknown>   // z.toJSONSchema of the response schema
  ```

- [ ] **Step 1: Failing golden tests for the packet schemas**

`packages/domain/src/scout/packets.test.ts`:
```ts
import {
  AreasResponseSchema,
  EnrichResponseSchema,
  PACKET_ID_PATTERN,
  PacketIdSchema,
  PacketRequestFileSchema,
  StaysResponseSchema,
  TrendsResponseSchema,
} from "./packets";

const finding = {
  placeName: "Gelateria La Sorbettiera",
  category: "food.dessert",
  whyTrending: "Named best gelato in Oltrarno in 2026 posts",
  sourceUrl: "https://example-blog.com/florence-gelato-2026",
  platformMentioned: "tiktok",
  evidenceQuote: "La Sorbettiera in Piazza Tasso is the one that went viral on TikTok this spring",
  approxDate: "2026-05",
};

test("trends: valid finding parses; extra field, long quote, bad url, bad date are rejected", () => {
  expect(TrendsResponseSchema.parse({ findings: [finding] }).findings).toHaveLength(1);
  expect(TrendsResponseSchema.parse({ findings: [] }).findings).toEqual([]);
  expect(() => TrendsResponseSchema.parse({ findings: [{ ...finding, lat: 43.7 }] })).toThrow();
  expect(() =>
    TrendsResponseSchema.parse({ findings: [{ ...finding, evidenceQuote: "x".repeat(241) }] }),
  ).toThrow();
  expect(() => TrendsResponseSchema.parse({ findings: [{ ...finding, sourceUrl: "ftp://x" }] })).toThrow();
  expect(() => TrendsResponseSchema.parse({ findings: [{ ...finding, approxDate: "May 2026" }] })).toThrow();
  expect(() => TrendsResponseSchema.parse({ findings: [{ ...finding, category: "food.gelato" }] })).toThrow();
});

const enriched = {
  id: "pl_abc",
  primaryCategory: "culture.museum",
  secondary: ["history.landmark"],
  dwellMin: 150,
  dwellRange: [120, 210],
  effort: 2,
  indoor: true,
  needsBooking: true,
  queueBufferMin: 45,
  bestTimeOfDay: ["morning"],
  kidFriendly: "partial",
  accessibility: "step-free entrance; lifts to all floors",
  priceLevel: 2,
  blurb: "The Medici's own collection in a 16th-century office block turned world museum.",
};

test("enrich: valid place parses; effort 4, priceLevel 5, unknown time of day, extra key rejected", () => {
  expect(EnrichResponseSchema.parse({ places: [enriched] }).places[0]?.id).toBe("pl_abc");
  expect(() => EnrichResponseSchema.parse({ places: [{ ...enriched, effort: 4 }] })).toThrow();
  expect(() => EnrichResponseSchema.parse({ places: [{ ...enriched, priceLevel: 5 }] })).toThrow();
  expect(() => EnrichResponseSchema.parse({ places: [{ ...enriched, bestTimeOfDay: ["dawn"] }] })).toThrow();
  expect(() => EnrichResponseSchema.parse({ places: [{ ...enriched, lat: 1 }] })).toThrow();
  expect(() => EnrichResponseSchema.parse({ places: [] })).toThrow();
});

test("areas: 1..16 areas with kind enum; coordinates are numbers in range", () => {
  const area = { name: "Florence", lat: 43.7696, lng: 11.2558, why: "capital", kind: "town" };
  expect(AreasResponseSchema.parse({ areas: [area] }).areas).toHaveLength(1);
  expect(() => AreasResponseSchema.parse({ areas: [] })).toThrow();
  expect(() => AreasResponseSchema.parse({ areas: Array(17).fill(area) })).toThrow();
  expect(() => AreasResponseSchema.parse({ areas: [{ ...area, kind: "city" }] })).toThrow();
  expect(() => AreasResponseSchema.parse({ areas: [{ ...area, lat: 91 }] })).toThrow();
});

test("stays: 1..4 zones each with 1..5 example properties", () => {
  const zone = {
    name: "Oltrarno",
    rationale: "quiet, artisan streets, 10 min walk to the Uffizi",
    exampleProperties: [{ name: "Hotel Palazzo Guadagni", website: "https://example.com", priceLevel: 3 }],
  };
  expect(StaysResponseSchema.parse({ zones: [zone] }).zones).toHaveLength(1);
  expect(() => StaysResponseSchema.parse({ zones: [] })).toThrow();
  expect(() => StaysResponseSchema.parse({ zones: Array(5).fill(zone) })).toThrow();
  expect(() => StaysResponseSchema.parse({ zones: [{ ...zone, exampleProperties: [] }] })).toThrow();
});

test("packet ids follow <type>-<n>; traversal and other names are rejected", () => {
  expect(PACKET_ID_PATTERN.test("trends-07")).toBe(true);
  expect(PacketIdSchema.parse("enrich-12")).toBe("enrich-12");
  for (const bad of ["../areas-1", "areas-1/../x", "areas", "areas-", "areas-1.response", "AREAS-1"]) {
    expect(() => PacketIdSchema.parse(bad)).toThrow();
  }
});

test("request file envelope", () => {
  const file = PacketRequestFileSchema.parse({
    packetId: "areas-1",
    type: "areas",
    attempt: 1,
    instructions: "Do X",
    schema: { type: "object" },
    payload: { a: 1 },
  });
  expect(file.type).toBe("areas");
  expect(() => PacketRequestFileSchema.parse({ ...file, type: "other" })).toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wayfare/domain test`
Expected: FAIL — `Cannot find module './packets'`.

- [ ] **Step 3: Implement the packet schemas**

`packages/domain/src/scout/packets.ts`:
```ts
import { z } from "zod";
import { PlaceCategorySchema, PlatformSchema } from "../taxonomy/categories";

export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const BBoxSchema = z.strictObject({
  south: z.number().min(-90).max(90),
  west: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const DestinationKindSchema = z.enum(["city", "region", "country"]);
export type DestinationKind = z.infer<typeof DestinationKindSchema>;
export const AreaKindSchema = z.enum(["town", "zone", "countryside"]);
export type AreaKind = z.infer<typeof AreaKindSchema>;
export const AreaTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type AreaTier = z.infer<typeof AreaTierSchema>;
export const BackendIdSchema = z.enum(["gemini", "agent"]);
export type BackendId = z.infer<typeof BackendIdSchema>;

const Text = (max: number) => z.string().trim().min(1).max(max);
const HttpUrl = z.url({ protocol: /^https?$/ });

// ---- areas -------------------------------------------------------------------------------
export const AreasRequestSchema = z.strictObject({
  destination: z.strictObject({ slug: Text(64), name: Text(120), kind: DestinationKindSchema }),
  bbox: BBoxSchema,
  hints: z.array(Text(200)).max(20),
  minAreas: z.number().int().min(1),
  maxAreas: z.number().int().min(1).max(16),
});
export type AreasRequest = z.infer<typeof AreasRequestSchema>;

export const AreaSuggestionSchema = z.strictObject({
  name: Text(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  why: Text(300),
  kind: AreaKindSchema,
});
export type AreaSuggestion = z.infer<typeof AreaSuggestionSchema>;

export const AreasResponseSchema = z.strictObject({
  areas: z.array(AreaSuggestionSchema).min(1).max(16),
});
export type AreasResponse = z.infer<typeof AreasResponseSchema>;

// ---- trends ------------------------------------------------------------------------------
export const TrendsRequestSchema = z.strictObject({
  area: z.strictObject({
    name: Text(120),
    lat: z.number(),
    lng: z.number(),
    kind: AreaKindSchema,
    tier: AreaTierSchema,
  }),
  theme: Text(40),
  queries: z.array(Text(200)).min(1).max(5),
  maxFindings: z.number().int().min(1).max(40),
  year: z.number().int().min(2020).max(2100),
});
export type TrendsRequest = z.infer<typeof TrendsRequestSchema>;

export const TrendFindingSchema = z.strictObject({
  placeName: Text(120),
  category: PlaceCategorySchema,
  whyTrending: Text(400),
  sourceUrl: HttpUrl,
  platformMentioned: PlatformSchema,
  evidenceQuote: Text(240),
  approxDate: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/).optional(),
});
export type TrendFinding = z.infer<typeof TrendFindingSchema>;

export const TrendsResponseSchema = z.strictObject({
  findings: z.array(TrendFindingSchema).max(40),
});
export type TrendsResponse = z.infer<typeof TrendsResponseSchema>;

// ---- enrich ------------------------------------------------------------------------------
export const EnrichCandidateSchema = z.strictObject({
  id: Text(64),
  name: Text(120),
  lat: z.number(),
  lng: z.number(),
  osmTags: z.record(z.string(), z.string()),
  wikidataDesc: Text(500).optional(),
});
export type EnrichCandidate = z.infer<typeof EnrichCandidateSchema>;

export const EnrichRequestSchema = z.strictObject({
  candidates: z.array(EnrichCandidateSchema).min(1).max(30),
  taxonomy: z.array(PlaceCategorySchema).min(1),
  dwellBands: z.record(z.string(), z.tuple([z.number(), z.number()])),
});
export type EnrichRequest = z.infer<typeof EnrichRequestSchema>;

export const TimeOfDaySchema = z.enum(["morning", "midday", "afternoon", "evening", "night"]);
export const KidFriendlySchema = z.enum(["yes", "partial", "no"]);

export const EnrichedPlaceSchema = z.strictObject({
  id: Text(64),
  primaryCategory: PlaceCategorySchema,
  secondary: z.array(PlaceCategorySchema).max(3),
  dwellMin: z.number().int().positive(),
  dwellRange: z.tuple([z.number().int().min(0), z.number().int().positive()]),
  effort: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  indoor: z.boolean(),
  needsBooking: z.boolean(),
  queueBufferMin: z.number().int().min(0).max(240),
  bestTimeOfDay: z.array(TimeOfDaySchema).max(5),
  kidFriendly: KidFriendlySchema,
  accessibility: z.string().trim().max(300),
  priceLevel: z.number().int().min(0).max(4),
  blurb: Text(400),
});
export type EnrichedPlace = z.infer<typeof EnrichedPlaceSchema>;

export const EnrichResponseSchema = z.strictObject({
  places: z.array(EnrichedPlaceSchema).min(1).max(30),
});
export type EnrichResponse = z.infer<typeof EnrichResponseSchema>;

// ---- stays -------------------------------------------------------------------------------
export const StaysRequestSchema = z.strictObject({
  area: z.strictObject({ name: Text(120), lat: z.number(), lng: z.number(), kind: AreaKindSchema }),
  accommodations: z
    .array(
      z.strictObject({
        name: Text(120),
        lat: z.number(),
        lng: z.number(),
        tourism: Text(40),
        website: HttpUrl.optional(),
        stars: Text(10).optional(),
      }),
    )
    .max(60),
  areaFacts: z.array(Text(300)).max(20),
});
export type StaysRequest = z.infer<typeof StaysRequestSchema>;

export const StayZoneSchema = z.strictObject({
  name: Text(120),
  rationale: Text(400),
  exampleProperties: z
    .array(
      z.strictObject({
        name: Text(120),
        website: HttpUrl.optional(),
        priceLevel: z.number().int().min(0).max(4),
      }),
    )
    .min(1)
    .max(5),
});
export type StayZone = z.infer<typeof StayZoneSchema>;

export const StaysResponseSchema = z.strictObject({ zones: z.array(StayZoneSchema).min(1).max(4) });
export type StaysResponse = z.infer<typeof StaysResponseSchema>;

// ---- envelope ----------------------------------------------------------------------------
export const PacketTypeSchema = z.enum(["areas", "trends", "enrich", "stays"]);
export type PacketType = z.infer<typeof PacketTypeSchema>;

/** File-name safe by construction: no dots, slashes or spaces can pass. */
export const PACKET_ID_PATTERN = /^(areas|trends|enrich|stays)-\d{1,4}$/;
export const PacketIdSchema = z.string().regex(PACKET_ID_PATTERN, "packetId must be <type>-<n>");

export const PACKET_SCHEMAS = {
  areas: { request: AreasRequestSchema, response: AreasResponseSchema },
  trends: { request: TrendsRequestSchema, response: TrendsResponseSchema },
  enrich: { request: EnrichRequestSchema, response: EnrichResponseSchema },
  stays: { request: StaysRequestSchema, response: StaysResponseSchema },
} as const;

export const PacketRequestFileSchema = z.strictObject({
  packetId: PacketIdSchema,
  type: PacketTypeSchema,
  attempt: z.number().int().min(1),
  instructions: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
  payload: z.unknown(),
});
export type PacketRequestFile = z.infer<typeof PacketRequestFileSchema>;

export const RejectionReasonSchema = z.strictObject({ path: z.string(), reason: z.string().min(1) });
export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

export const PacketRejectionSchema = z.strictObject({
  packetId: PacketIdSchema,
  attempts: z.array(
    z.strictObject({
      attempt: z.number().int().min(1),
      at: z.iso.datetime(),
      /** sha1 of the rejected response text; an unchanged response is not re-counted. */
      responseSha1: z.string().length(40),
      reasons: z.array(RejectionReasonSchema).min(1),
    }),
  ),
});
export type PacketRejection = z.infer<typeof PacketRejectionSchema>;
```

- [ ] **Step 4: Failing tests for the document schemas and `effectivePlace()`**

`packages/domain/src/scout/documents.test.ts`:
```ts
import {
  DestinationSchema,
  EvidenceSchema,
  PendingMergeSchema,
  PlaceSchema,
  ReviewSessionSchema,
  ScoutRunSchema,
  effectivePlace,
} from "./documents";

export const basePlace = () =>
  PlaceSchema.parse({
    id: "pl_0123456789abcdef01234567",
    destSlug: "tuscany",
    name: "Museo Galileo",
    normalizedName: "galileo",
    geohash7: "spz7x8k",
    lat: 43.7678,
    lng: 11.2559,
    areaName: "Florence",
    secondary: [],
    bestTimeOfDay: [],
    hoursStatus: "known",
    openingHours: "Mo-Su 09:30-18:00",
    fameScore: 55,
    trendScore: 0,
    sources: [{ kind: "osm", ref: "way/123" }],
    source: "scout",
    runId: "run_1",
    packetIds: [],
    aliases: [],
    externalIds: { osm: "way/123" },
    verification: { geocoded: true, sourcesCount: 1, quoteVerified: false },
    adminOverrides: {},
    status: "active",
    firstSeenAt: "2026-09-21T10:00:00.000Z",
    lastSeenRunId: "run_1",
    timesFlagged: 0,
    primaryCategory: "culture.museum",
    dwellMin: 90,
  });

test("place document round-trips and rejects unknown status", () => {
  const p = basePlace();
  expect(p.status).toBe("active");
  expect(() => PlaceSchema.parse({ ...p, status: "deleted" })).toThrow();
});

test("effectivePlace applies adminOverrides values without mutating the base", () => {
  const p = basePlace();
  p.adminOverrides = {
    dwellMin: { value: 120, by: "admin", at: "2026-09-21T11:00:00.000Z" },
    status: { value: "hidden", by: "admin", at: "2026-09-21T11:00:00.000Z" },
  };
  const eff = effectivePlace(p);
  expect(eff.dwellMin).toBe(120);
  expect(eff.status).toBe("hidden");
  expect(p.dwellMin).toBe(90);
  expect(eff.adminOverrides).toEqual(p.adminOverrides);
});

test("effectivePlace ignores overrides for fields that are not on the schema", () => {
  const p = basePlace();
  p.adminOverrides = { evilField: { value: 1, by: "admin", at: "2026-09-21T11:00:00.000Z" } };
  expect("evilField" in effectivePlace(p)).toBe(false);
});

test("evidence, pendingMerge, scoutRun, reviewSession, destination parse", () => {
  expect(
    EvidenceSchema.parse({
      id: "e1",
      placeId: "pl_1",
      url: "https://example.com/a",
      platform: "tiktok",
      quote: "went viral",
      quoteVerified: true,
      fetchedAt: "2026-09-21T10:00:00.000Z",
      backend: "agent",
      runId: "run_1",
    }).quoteVerified,
  ).toBe(true);
  expect(
    PendingMergeSchema.parse({
      id: "pm1", destSlug: "tuscany", placeIdA: "a", placeIdB: "b", score: 0.85,
      reasons: ["jw 0.85", "distance 120m"], status: "open",
    }).status,
  ).toBe("open");
  expect(
    ScoutRunSchema.parse({
      runId: "run_1", destSlug: "tuscany", backend: "agent", startedBy: "cursor",
      startedAt: "2026-09-21T10:00:00.000Z", stages: {}, budget: { llmCalls: 0, searches: 0 },
      rejectedPackets: [], errors: [],
    }).startedBy,
  ).toBe("cursor");
  expect(
    ReviewSessionSchema.parse({
      id: "rs1", destSlug: "tuscany", runId: "run_1",
      sample: [{ placeId: "a", bucket: "random" }], verdicts: { a: "correct" }, accuracy: 1,
      startedAt: "2026-09-21T10:00:00.000Z",
    }).accuracy,
  ).toBe(1);
  expect(
    DestinationSchema.parse({
      slug: "tuscany", name: "Tuscany", kind: "region",
      geometry: { bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 }, center: { lat: 43.4, lng: 11.1 } },
      queueOrder: 1, status: "queued", requestedBy: "admin",
      counts: { scouted: 0, userFound: 0, trending: 0, hidden: 0 },
    }).kind,
  ).toBe("region");
});
```

- [ ] **Step 5: Implement the document schemas**

`packages/domain/src/scout/documents.ts`:
```ts
import { z } from "zod";
import { PlaceCategorySchema, PlatformSchema } from "../taxonomy/categories";
import {
  AreaTierSchema,
  BBoxSchema,
  BackendIdSchema,
  DestinationKindSchema,
  KidFriendlySchema,
  LatLngSchema,
  RejectionReasonSchema,
  TimeOfDaySchema,
} from "./packets";

const Iso = z.iso.datetime();

// ---- destinations ---------------------------------------------------------------------------
export const DestinationGeometrySchema = z.strictObject({
  bbox: BBoxSchema,
  center: LatLngSchema,
  radiusKm: z.number().positive().optional(),
  /** Firestore path of the (possibly simplified) polygon document, spec §8.1. */
  polygonRef: z.string().optional(),
});
export type DestinationGeometry = z.infer<typeof DestinationGeometrySchema>;

export const DestinationStatusSchema = z.enum(["queued", "building", "ready", "stale", "failed"]);

export const DestinationSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1),
  kind: DestinationKindSchema,
  geometry: DestinationGeometrySchema,
  queueOrder: z.number().int().min(0),
  status: DestinationStatusSchema,
  requestedBy: z.literal("admin"),
  lastRunId: z.string().optional(),
  counts: z.strictObject({
    scouted: z.number().int().min(0),
    userFound: z.number().int().min(0),
    trending: z.number().int().min(0),
    hidden: z.number().int().min(0),
  }),
  lock: z.strictObject({ runId: z.string(), startedAt: Iso }).optional(),
  hints: z.array(z.string()).optional(),
});
export type Destination = z.infer<typeof DestinationSchema>;

// ---- places -----------------------------------------------------------------------------------
export const PlaceSourceSchema = z.enum(["scout", "user_request", "admin"]);
export const PlaceStatusSchema = z.enum(["active", "hidden", "tombstoned", "unenriched"]);
export type PlaceStatus = z.infer<typeof PlaceStatusSchema>;
export const HoursStatusSchema = z.enum(["known", "unknown"]);
export const SourceRefSchema = z.strictObject({
  kind: z.enum(["osm", "wikidata", "web", "llm", "agent"]),
  ref: z.string().min(1),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
export const AdminOverrideSchema = z.strictObject({ value: z.unknown(), by: z.string(), at: Iso });
export const ExternalIdsSchema = z.strictObject({
  osm: z.string().optional(),
  wikidata: z.string().optional(),
  website: z.string().optional(),
});
export type ExternalIds = z.infer<typeof ExternalIdsSchema>;
export const VerificationSchema = z.strictObject({
  geocoded: z.boolean(),
  sourcesCount: z.number().int().min(0),
  quoteVerified: z.boolean(),
});
export const PlaceImageSchema = z.strictObject({ url: z.url(), licence: z.string(), author: z.string() });

export const PlaceSchema = z.strictObject({
  id: z.string().min(1),
  destSlug: z.string().min(1),
  name: z.string().min(1),
  normalizedName: z.string(),
  geohash7: z.string().length(7),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  areaName: z.string().min(1),
  primaryCategory: PlaceCategorySchema.optional(),
  secondary: z.array(PlaceCategorySchema),
  dwellMin: z.number().int().positive().optional(),
  dwellRange: z.tuple([z.number().int().min(0), z.number().int().positive()]).optional(),
  effort: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  indoor: z.boolean().optional(),
  openingHours: z.string().optional(),
  hoursStatus: HoursStatusSchema,
  priceLevel: z.number().int().min(0).max(4).optional(),
  needsBooking: z.boolean().optional(),
  queueBufferMin: z.number().int().min(0).optional(),
  bestTimeOfDay: z.array(TimeOfDaySchema),
  kidFriendly: KidFriendlySchema.optional(),
  accessibility: z.string().optional(),
  website: z.string().optional(),
  wikidataId: z.string().optional(),
  wikidataDescription: z.string().optional(),
  sitelinks: z.number().int().min(0).optional(),
  cuisine: z.string().optional(),
  blurb: z.string().optional(),
  fameScore: z.number().min(0).max(100),
  trendScore: z.number().min(0).max(100),
  sources: z.array(SourceRefSchema),
  source: PlaceSourceSchema,
  backend: BackendIdSchema.optional(),
  model: z.string().optional(),
  runId: z.string(),
  packetIds: z.array(z.string()),
  aliases: z.array(z.string()),
  externalIds: ExternalIdsSchema,
  verification: VerificationSchema,
  adminOverrides: z.record(z.string(), AdminOverrideSchema),
  status: PlaceStatusSchema,
  mergedInto: z.string().optional(),
  image: PlaceImageSchema.optional(),
  firstSeenAt: Iso,
  lastSeenRunId: z.string(),
  notSeenSince: Iso.optional(),
  timesFlagged: z.number().int().min(0),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Base fields with each adminOverrides[field].value applied (spec §5). Unknown fields are ignored. */
export function effectivePlace(place: Place): Place {
  const out: Record<string, unknown> = { ...place };
  const known = new Set(Object.keys(PlaceSchema.shape));
  for (const [field, override] of Object.entries(place.adminOverrides)) {
    if (field === "adminOverrides" || !known.has(field)) continue;
    out[field] = override.value;
  }
  return PlaceSchema.parse(out);
}

// ---- evidence ---------------------------------------------------------------------------------
export const EvidenceSchema = z.strictObject({
  id: z.string().min(1),
  placeId: z.string().min(1),
  url: z.url(),
  platform: PlatformSchema,
  quote: z.string().min(1).max(240),
  quoteVerified: z.boolean(),
  verifyReason: z.string().optional(),
  approxDate: z.string().optional(),
  fetchedAt: Iso,
  backend: BackendIdSchema,
  runId: z.string(),
  packetId: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---- merges / runs / reviews -------------------------------------------------------------
export const PendingMergeSchema = z.strictObject({
  id: z.string().min(1),
  destSlug: z.string(),
  placeIdA: z.string(),
  placeIdB: z.string(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  status: z.enum(["open", "merged", "kept_both"]),
  resolvedBy: z.string().optional(),
  resolvedAt: Iso.optional(),
});
export type PendingMerge = z.infer<typeof PendingMergeSchema>;

export const StageRunSchema = z.strictObject({
  startedAt: Iso,
  finishedAt: Iso.optional(),
  counts: z.record(z.string(), z.number()),
});
export type StageRun = z.infer<typeof StageRunSchema>;

export const ScoutRunSchema = z.strictObject({
  runId: z.string(),
  destSlug: z.string(),
  backend: BackendIdSchema,
  startedBy: z.enum(["owner", "actions", "cursor"]),
  startedAt: Iso,
  finishedAt: Iso.optional(),
  stages: z.record(z.string(), StageRunSchema),
  budget: z.strictObject({ llmCalls: z.number().int().min(0), searches: z.number().int().min(0) }),
  rejectedPackets: z.array(
    z.strictObject({ packetId: z.string(), attempt: z.number().int(), reasons: z.array(RejectionReasonSchema) }),
  ),
  errors: z.array(z.string()),
  reportMarkdown: z.string().optional(),
  forced: z.boolean().optional(),
});
export type ScoutRun = z.infer<typeof ScoutRunSchema>;

export const ReviewSessionSchema = z.strictObject({
  id: z.string(),
  destSlug: z.string(),
  runId: z.string(),
  sample: z.array(z.strictObject({ placeId: z.string(), bucket: z.enum(["random", "topTrend"]) })),
  verdicts: z.record(z.string(), z.string().regex(/^(correct|hide|wrong:.+)$/)),
  accuracy: z.number().min(0).max(1),
  startedAt: Iso,
  completedAt: Iso.optional(),
});
export type ReviewSession = z.infer<typeof ReviewSessionSchema>;

/** Stage-1 area with the CLI's verified coordinates and harvest bbox (work/<dest>/01-areas.json). */
export const AreaRecordSchema = z.strictObject({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  lat: z.number(),
  lng: z.number(),
  kind: z.enum(["town", "zone", "countryside"]),
  why: z.string(),
  bbox: BBoxSchema,
  wikidataId: z.string().optional(),
  sitelinks: z.number().int().min(0).optional(),
  tier: AreaTierSchema.optional(),
  packetId: z.string(),
});
export type AreaRecord = z.infer<typeof AreaRecordSchema>;
```

- [ ] **Step 6: Failing tests for `validatePacketResponse()`**

`packages/domain/src/scout/validate.test.ts`:
```ts
import { DEFAULT_DWELL_BANDS, SELECTABLE_CATEGORIES } from "../taxonomy/categories";
import type { AreasRequest, EnrichRequest, TrendsRequest } from "./packets";
import { validatePacketResponse } from "./validate";

const areasReq: AreasRequest = {
  destination: { slug: "tuscany", name: "Tuscany", kind: "region" },
  bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 },
  hints: [],
  minAreas: 2,
  maxAreas: 16,
};
const area = (name: string, lat: number, lng: number) => ({ name, lat, lng, why: "w", kind: "town" as const });

test("areas: too few, outside bbox, duplicate names", () => {
  const ok = validatePacketResponse("areas", areasReq, {
    areas: [area("Florence", 43.77, 11.25), area("Siena", 43.32, 11.33)],
  });
  expect(ok.ok).toBe(true);
  const few = validatePacketResponse("areas", areasReq, { areas: [area("Florence", 43.77, 11.25)] });
  expect(few.ok).toBe(false);
  if (!few.ok) expect(few.reasons[0]?.reason).toMatch(/too few areas/);
  const out = validatePacketResponse("areas", areasReq, {
    areas: [area("Florence", 43.77, 11.25), area("Rome", 41.9, 12.5)],
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.reasons).toEqual([{ path: "areas.1", reason: "coords outside bbox" }]);
  const dup = validatePacketResponse("areas", areasReq, {
    areas: [area("Florence", 43.77, 11.25), area("florence", 43.78, 11.26)],
  });
  expect(dup.ok).toBe(false);
  if (!dup.ok) expect(dup.reasons[0]?.reason).toMatch(/duplicate area/);
});

test("invalid JSON shape produces path + message reasons, not an exception", () => {
  const r = validatePacketResponse("areas", areasReq, { areas: "nope" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons[0]?.path).toBe("areas");
});

const trendsReq: TrendsRequest = {
  area: { name: "Florence", lat: 43.77, lng: 11.25, kind: "town", tier: 1 },
  theme: "dessert",
  queries: ["best gelato Florence 2026"],
  maxFindings: 2,
  year: 2026,
};
const finding = {
  placeName: "Gelateria La Sorbettiera",
  category: "food.dessert",
  whyTrending: "viral",
  sourceUrl: "https://example-blog.com/florence-gelato-2026",
  platformMentioned: "tiktok",
  evidenceQuote: "went viral on TikTok this spring",
};

test("trends: too many findings, duplicate (name,url), non-selectable category", () => {
  expect(validatePacketResponse("trends", trendsReq, { findings: [finding] }).ok).toBe(true);
  const many = validatePacketResponse("trends", trendsReq, {
    findings: [finding, { ...finding, placeName: "B" }, { ...finding, placeName: "C" }],
  });
  expect(many.ok).toBe(false);
  if (!many.ok) expect(many.reasons[0]?.reason).toMatch(/too many findings/);
  const dup = validatePacketResponse("trends", trendsReq, { findings: [finding, finding] });
  expect(dup.ok).toBe(false);
  if (!dup.ok) expect(dup.reasons[0]).toEqual({ path: "findings.1", reason: "duplicate finding" });
  const logi = validatePacketResponse("trends", trendsReq, {
    findings: [{ ...finding, category: "logistics.rest" }],
  });
  expect(logi.ok).toBe(false);
  if (!logi.ok) expect(logi.reasons[0]?.reason).toBe("category not selectable");
});

const enrichReq: EnrichRequest = {
  candidates: [
    { id: "pl_a", name: "Museo Galileo", lat: 43.76, lng: 11.25, osmTags: { tourism: "museum" } },
    { id: "pl_b", name: "Gelateria La Carraia", lat: 43.76, lng: 11.24, osmTags: { amenity: "ice_cream" } },
  ],
  taxonomy: [...SELECTABLE_CATEGORIES],
  dwellBands: Object.fromEntries(Object.entries(DEFAULT_DWELL_BANDS).map(([k, v]) => [k, [v[0], v[1]]])),
};
const enriched = (id: string, primaryCategory: string, dwellMin: number) => ({
  id,
  primaryCategory,
  secondary: [],
  dwellMin,
  dwellRange: [Math.max(0, dwellMin - 30), dwellMin + 30],
  effort: 1,
  indoor: true,
  needsBooking: false,
  queueBufferMin: 0,
  bestTimeOfDay: ["morning"],
  kidFriendly: "yes",
  accessibility: "",
  priceLevel: 2,
  blurb: "b",
});

test("enrich: echo ids exactly, dwell bands, dwellRange containment, secondary != primary", () => {
  const ok = validatePacketResponse("enrich", enrichReq, {
    places: [enriched("pl_a", "culture.museum", 90), enriched("pl_b", "food.dessert", 20)],
  });
  expect(ok.ok).toBe(true);

  const unknown = validatePacketResponse("enrich", enrichReq, {
    places: [enriched("pl_a", "culture.museum", 90), enriched("pl_zzz", "food.dessert", 20)],
  });
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) {
    expect(unknown.reasons).toEqual(
      expect.arrayContaining([
        { path: "places.1.id", reason: "unknown id" },
        { path: "places", reason: "missing id pl_b" },
      ]),
    );
  }

  const dupId = validatePacketResponse("enrich", enrichReq, {
    places: [enriched("pl_a", "culture.museum", 90), enriched("pl_a", "culture.museum", 90)],
  });
  expect(dupId.ok).toBe(false);
  if (!dupId.ok) expect(dupId.reasons.some((r) => r.reason === "duplicate id")).toBe(true);

  const dwell = validatePacketResponse("enrich", enrichReq, {
    places: [enriched("pl_a", "culture.museum", 10), enriched("pl_b", "food.dessert", 180)],
  });
  expect(dwell.ok).toBe(false);
  if (!dwell.ok) {
    expect(dwell.reasons).toEqual([
      { path: "places.0.dwellMin", reason: "dwell implausible for category (culture.museum expects 60–240)" },
      { path: "places.1.dwellMin", reason: "dwell implausible for category (food.dessert expects 10–40)" },
    ]);
  }

  const range = validatePacketResponse("enrich", enrichReq, {
    places: [
      { ...enriched("pl_a", "culture.museum", 90), dwellRange: [100, 120] },
      enriched("pl_b", "food.dessert", 20),
    ],
  });
  expect(range.ok).toBe(false);
  if (!range.ok) expect(range.reasons[0]?.reason).toBe("dwellMin outside dwellRange");

  const sec = validatePacketResponse("enrich", enrichReq, {
    places: [
      { ...enriched("pl_a", "culture.museum", 90), secondary: ["culture.museum"] },
      enriched("pl_b", "food.dessert", 20),
    ],
  });
  expect(sec.ok).toBe(false);
  if (!sec.ok) expect(sec.reasons[0]?.reason).toBe("secondary repeats primaryCategory");
});

test("stays: duplicate zone names rejected", () => {
  const zone = { name: "Oltrarno", rationale: "r", exampleProperties: [{ name: "H", priceLevel: 2 }] };
  const req = { area: { name: "Florence", lat: 43.7, lng: 11.2, kind: "town" as const }, accommodations: [], areaFacts: [] };
  const r = validatePacketResponse("stays", req, { zones: [zone, { ...zone, name: "oltrarno" }] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons[0]?.reason).toMatch(/duplicate zone/);
});
```

- [ ] **Step 7: Implement `validatePacketResponse()`**

`packages/domain/src/scout/validate.ts`:
```ts
import type { ZodError } from "zod";
import { type PlaceCategory, SELECTABLE_CATEGORIES } from "../taxonomy/categories";
import {
  type AreasRequest,
  type AreasResponse,
  type EnrichRequest,
  type EnrichResponse,
  PACKET_SCHEMAS,
  type PacketType,
  type RejectionReason,
  type StaysRequest,
  type StaysResponse,
  type TrendsRequest,
  type TrendsResponse,
} from "./packets";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reasons: RejectionReason[] };

const SELECTABLE = new Set<string>(SELECTABLE_CATEGORIES);

function zodReasons(err: ZodError): RejectionReason[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join("."), reason: i.message }));
}

function insideBBox(b: AreasRequest["bbox"], lat: number, lng: number): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

const key = (s: string) => s.trim().toLowerCase();

function semanticAreas(req: AreasRequest, res: AreasResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (res.areas.length < req.minAreas) {
    reasons.push({ path: "areas", reason: `too few areas (got ${res.areas.length}, need ≥ ${req.minAreas})` });
  }
  if (res.areas.length > req.maxAreas) {
    reasons.push({ path: "areas", reason: `too many areas (got ${res.areas.length}, max ${req.maxAreas})` });
  }
  const seen = new Set<string>();
  res.areas.forEach((a, i) => {
    if (!insideBBox(req.bbox, a.lat, a.lng)) reasons.push({ path: `areas.${i}`, reason: "coords outside bbox" });
    if (seen.has(key(a.name))) reasons.push({ path: `areas.${i}.name`, reason: `duplicate area "${a.name}"` });
    seen.add(key(a.name));
  });
  return reasons;
}

function semanticTrends(req: TrendsRequest, res: TrendsResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (res.findings.length > req.maxFindings) {
    reasons.push({
      path: "findings",
      reason: `too many findings (got ${res.findings.length}, max ${req.maxFindings})`,
    });
  }
  const seen = new Set<string>();
  res.findings.forEach((f, i) => {
    const k = `${key(f.placeName)}|${f.sourceUrl}`;
    if (seen.has(k)) reasons.push({ path: `findings.${i}`, reason: "duplicate finding" });
    seen.add(k);
    if (!SELECTABLE.has(f.category)) reasons.push({ path: `findings.${i}.category`, reason: "category not selectable" });
  });
  return reasons;
}

function bandFor(req: EnrichRequest, cat: PlaceCategory): [number, number] | undefined {
  const group = cat.slice(0, cat.indexOf("."));
  return req.dwellBands[cat] ?? req.dwellBands[group];
}

function semanticEnrich(req: EnrichRequest, res: EnrichResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const requested = new Set(req.candidates.map((c) => c.id));
  const seen = new Set<string>();
  res.places.forEach((p, i) => {
    if (!requested.has(p.id)) reasons.push({ path: `places.${i}.id`, reason: "unknown id" });
    else if (seen.has(p.id)) reasons.push({ path: `places.${i}.id`, reason: "duplicate id" });
    seen.add(p.id);
    if (!SELECTABLE.has(p.primaryCategory)) {
      reasons.push({ path: `places.${i}.primaryCategory`, reason: "category not selectable" });
    }
    const band = bandFor(req, p.primaryCategory);
    if (band && (p.dwellMin < band[0] || p.dwellMin > band[1])) {
      reasons.push({
        path: `places.${i}.dwellMin`,
        reason: `dwell implausible for category (${p.primaryCategory} expects ${band[0]}–${band[1]})`,
      });
    }
    if (p.dwellMin < p.dwellRange[0] || p.dwellMin > p.dwellRange[1] || p.dwellRange[0] > p.dwellRange[1]) {
      reasons.push({ path: `places.${i}.dwellRange`, reason: "dwellMin outside dwellRange" });
    }
    if (p.secondary.includes(p.primaryCategory)) {
      reasons.push({ path: `places.${i}.secondary`, reason: "secondary repeats primaryCategory" });
    }
  });
  for (const id of requested) {
    if (!seen.has(id)) reasons.push({ path: "places", reason: `missing id ${id}` });
  }
  return reasons;
}

function semanticStays(_req: StaysRequest, res: StaysResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const seen = new Set<string>();
  res.zones.forEach((z, i) => {
    if (seen.has(key(z.name))) reasons.push({ path: `zones.${i}.name`, reason: `duplicate zone "${z.name}"` });
    seen.add(key(z.name));
  });
  return reasons;
}

export function validatePacketResponse(type: "areas", request: AreasRequest, raw: unknown): ValidationResult<AreasResponse>;
export function validatePacketResponse(type: "trends", request: TrendsRequest, raw: unknown): ValidationResult<TrendsResponse>;
export function validatePacketResponse(type: "enrich", request: EnrichRequest, raw: unknown): ValidationResult<EnrichResponse>;
export function validatePacketResponse(type: "stays", request: StaysRequest, raw: unknown): ValidationResult<StaysResponse>;
export function validatePacketResponse(type: PacketType, request: unknown, raw: unknown): ValidationResult<unknown>;
export function validatePacketResponse(type: PacketType, request: unknown, raw: unknown): ValidationResult<unknown> {
  const parsed = PACKET_SCHEMAS[type].response.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: zodReasons(parsed.error) };
  let reasons: RejectionReason[];
  switch (type) {
    case "areas":
      reasons = semanticAreas(request as AreasRequest, parsed.data as AreasResponse);
      break;
    case "trends":
      reasons = semanticTrends(request as TrendsRequest, parsed.data as TrendsResponse);
      break;
    case "enrich":
      reasons = semanticEnrich(request as EnrichRequest, parsed.data as EnrichResponse);
      break;
    case "stays":
      reasons = semanticStays(request as StaysRequest, parsed.data as StaysResponse);
      break;
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, data: parsed.data };
}
```

- [ ] **Step 8: Failing test + implementation for `packetJsonSchema()`**

`packages/domain/src/scout/jsonSchema.test.ts`:
```ts
import { packetJsonSchema } from "./jsonSchema";

test("response JSON schema is an object schema with the top-level array and no $schema key", () => {
  const s = packetJsonSchema("trends") as { type: string; properties: Record<string, unknown>; $schema?: string };
  expect(s.type).toBe("object");
  expect(Object.keys(s.properties)).toEqual(["findings"]);
  expect(s.$schema).toBeUndefined();
  expect(JSON.stringify(s)).toContain("food.dessert");
});

test("every packet type has a schema", () => {
  for (const t of ["areas", "trends", "enrich", "stays"] as const) {
    expect((packetJsonSchema(t) as { type: string }).type).toBe("object");
  }
});
```

`packages/domain/src/scout/jsonSchema.ts`:
```ts
import { z } from "zod";
import { PACKET_SCHEMAS, type PacketType } from "./packets";

/** JSON Schema (draft 2020-12, `$schema` removed) of a packet's response, for prompts and packets. */
export function packetJsonSchema(type: PacketType): Record<string, unknown> {
  const schema = z.toJSONSchema(PACKET_SCHEMAS[type].response, { target: "draft-2020-12" });
  const { $schema: _omit, ...rest } = schema as Record<string, unknown>;
  return rest;
}
```

Add to `packages/domain/src/index.ts`:
```ts
export * from "./scout/documents";
export * from "./scout/jsonSchema";
export * from "./scout/packets";
export * from "./scout/validate";
```

- [ ] **Step 9: Run tests, lint, typecheck**

Run: `pnpm --filter @wayfare/domain test && pnpm lint:fix && pnpm lint && pnpm typecheck`
Expected: all PASS. If Biome flags the overload lines for width, let `lint:fix` wrap them.

- [ ] **Step 10: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): scout packet and document schemas, validatePacketResponse, packet JSON schema"
```

---

### Task 3: `apps/scout` CLI scaffold, work-dir I/O, status board, exit codes

**Files:**
- Create: `apps/scout/package.json`, `apps/scout/tsconfig.json`, `apps/scout/vitest.config.ts`
- Create: `apps/scout/src/cli.ts`, `apps/scout/src/exitCodes.ts`, `apps/scout/src/workDir.ts`, `apps/scout/src/workDir.test.ts`, `apps/scout/src/status.ts`, `apps/scout/src/status.test.ts`
- Create: `work/README.md`
- Modify: root `package.json` (script `scout`), `.gitignore`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 yet.
- Produces:
  ```ts
  const EXIT = { done: 0, error: 1, refused: 2, awaitingPackets: 3, pausedBudget: 4, pausedRejections: 5 } as const;
  interface WorkLayout { root: string; stageFile(n: number, name: string): string; packetsDir: string; outDir: string }
  function openWork(repoRoot: string, slug: string): WorkLayout
  function assertSafeSlug(slug: string): string   // throws on "..", slashes, empty
  interface StatusBoard { slug: string; stage: string; packets: { pending: number; answered: number; rejected: number }; places: number; budget: { llmCalls: number; searches: number }; elapsedSec: number }
  function formatStatus(b: StatusBoard): string
  ```

- [ ] **Step 1: Failing tests**

`apps/scout/src/workDir.test.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSlug, openWork } from "./workDir";

test("slug rejects traversal", () => {
  expect(() => assertSafeSlug("..")).toThrow(/slug/);
  expect(() => assertSafeSlug("a/b")).toThrow(/slug/);
  expect(assertSafeSlug("tuscany")).toBe("tuscany");
});

test("openWork stays inside work/<slug>", () => {
  const root = mkdtempSync(join(tmpdir(), "scout-"));
  const w = openWork(root, "tuscany");
  expect(w.stageFile(2, "harvest")).toBe(join(root, "work", "tuscany", "02-harvest.json"));
  expect(w.packetsDir.endsWith(join("work", "tuscany", "packets"))).toBe(true);
});
```

`apps/scout/src/status.test.ts`:
```ts
import { formatStatus } from "./status";

test("status board names stage, packets and budget", () => {
  const text = formatStatus({
    slug: "tuscany",
    stage: "03-trends",
    packets: { pending: 2, answered: 4, rejected: 1 },
    places: 80,
    budget: { llmCalls: 6, searches: 4 },
    elapsedSec: 12,
  });
  expect(text).toContain("tuscany");
  expect(text).toContain("03-trends");
  expect(text).toContain("pending 2");
  expect(text).toContain("llm 6");
});
```

- [ ] **Step 2: Run** `pnpm --filter @wayfare/scout test` — FAIL, module missing. (Create the package first so the filter resolves: `package.json` name `@wayfare/scout`, `"scout": "tsx src/cli.ts"`, `"test": "vitest run"`, deps `commander`, `zod`, `@wayfare/domain`, `@wayfare/providers`; devDeps `tsx`, `vitest`, `typescript`. Root script `"scout": "pnpm --filter @wayfare/scout scout --"`.)

- [ ] **Step 3: Implement** `assertSafeSlug` with `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. `openWork` uses `node:path.join` only. `formatStatus` prints one screen of labelled lines. `cli.ts` uses `commander` flags from spec §2.1: `--backend <gemini|agent>`, `--stage <n>`, `--from <n>`, `--dry-run`, `--budget <n>`, `--resume`, `--status`, `--report`, `--dedupe`, `--force`. Unknown slug or `--backend gemini` with missing `GEMINI_API_KEY`/`TAVILY_API_KEY` → exit 2 before any network. Default command with no packets and no stage yet prints the board and exits 0.

`.gitignore` additions:
```
work/**
!work/README.md
!.cursor/skills/
!.cursor/skills/**
```
`work/README.md` states that everything else under `work/` is generated and git-ignored.

- [ ] **Step 4: Run** `pnpm --filter @wayfare/scout test && pnpm lint:fix && pnpm lint && pnpm typecheck` — PASS.

- [ ] **Step 5: Commit** `feat(scout): CLI scaffold, work directory, status board, exit codes`

---

### Task 4: Geometry, Nominatim, rate limit, geocode cache

**Files:**
- Create: `apps/scout/src/net/rateLimit.ts`, `rateLimit.test.ts`, `ssrf.ts`, `ssrf.test.ts`, `nominatim.ts`, `nominatim.test.ts`, `geometry.ts`, `geometry.test.ts`

**Interfaces:**
- Consumes: `BBox`, `LatLng`, `AreaKind`, `ScoutConfig` (Tasks 1–2). `DEFAULT_SCOUT_CONFIG.nominatim`, `.areaRadiusKm`, `.polygon`.
- Produces:
  ```ts
  function createLimiter(minIntervalMs: number, now?: () => number, sleep?: (ms: number) => Promise<void>): { wait(): Promise<void> }
  function isPublicIp(ip: string): boolean
  async function assertPublicUrl(url: string, lookup?: (host: string) => Promise<string[]>): Promise<void>
  interface GeocodeCache { get(key: string): Promise<unknown | undefined>; set(key: string, value: unknown): Promise<void> }
  class FileGeocodeCache implements GeocodeCache
  interface NominatimClient { search(q: string, kind: "city"|"region"|"country"): Promise<DestinationGeometry & { polygon?: GeoJSON.Polygon }>; reverse(lat: number, lng: number): Promise<{ displayName: string } | undefined> }
  function createNominatim(opts: { fetchImpl: typeof fetch; cache: GeocodeCache; userAgent: string; minIntervalMs: number }): NominatimClient
  function areaCircleBBox(center: LatLng, kind: AreaKind, cfg: ScoutConfig): BBox
  function pointInside(lat: number, lng: number, polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean
  ```

- [ ] **Step 1: Failing tests**

Rate limit: two `wait()` calls with a fake clock advance; the second does not resolve until `minIntervalMs` has elapsed (assert `sleep` was called with the remainder).

SSRF: `assertPublicUrl("http://127.0.0.1/x")` throws; `http://10.1.1.1/` throws; `file:///etc/passwd` throws; a host whose lookup returns `8.8.8.8` resolves. `isPublicIp("169.254.1.1")` is false; `isPublicIp("1.1.1.1")` is true.

Nominatim: injected fetch returns one Florence result with a polygon; second call for the same query hits the cache (fetch called once); User-Agent header equals the config string; two searches honour the limiter.

Geometry: `areaCircleBBox({lat:43.77,lng:11.25},"town", DEFAULT_SCOUT_CONFIG)` spans roughly ±3 km (assert north-south delta between 0.04 and 0.07 degrees). `pointInside` of Florence centre in a square polygon around it is true; a point in Rome is false.

- [ ] **Step 2: Run** — FAIL, modules missing.

- [ ] **Step 3: Implement**

`isPublicIp` rejects IPv4 private, loopback, link-local, unspecified, and IPv6 `::1`, `fc00::/7`, `fe80::/10`. `assertPublicUrl` parses the URL, allows only `http:`/`https:`, resolves DNS (injected), and checks every address.

`createNominatim` calls `https://nominatim.openstreetmap.org/search?q=&format=jsonv2&polygon_geojson=1&limit=1`, filters `category=boundary` for region/country, stores the result under `sha1(kind|q)`. If `polygon_geojson` byte length exceeds `polygon.simplifyAboveBytes`, run `@turf/simplify` with `polygon.simplifyTolerance`.

`pointInside` uses `@turf/boolean-point-in-polygon`. `areaCircleBBox` converts km to degrees (`lat += km/110.574`, `lng += km/(111.320*cos(lat))`).

- [ ] **Step 4: Run** tests, lint, typecheck — PASS.

- [ ] **Step 5: Commit** `feat(scout): nominatim, geometry, rate limit, SSRF check`

---

### Task 5: `normalizeName`, Jaro–Winkler, `placeId`, `resolvePlace`

**Files:**
- Create: `apps/scout/src/resolve/normalize.ts`, `jaro.ts`, `placeId.ts`, `resolvePlace.ts`, and a `*.test.ts` beside each
- Create: `apps/scout/fixtures/dedupe-pairs.json`

**Interfaces:**
- Consumes: `PlaceCategory`, `categoryGroup` (Task 1).
- Produces:
  ```ts
  function normalizeName(name: string): string
  function jaroWinkler(a: string, b: string): number
  function placeIdFor(normalizedName: string, lat: number, lng: number): string   // "pl_" + sha1(name|geohash7).slice(0, 16)
  type ResolveHit = { kind: "match"; rung: 1|2|3|4; placeId: string } | { kind: "new"; placeId: string } | { kind: "ambiguous"; candidates: string[]; score: number }
  function resolvePlace(candidate: { name: string; lat: number; lng: number; category: PlaceCategory; osmId?: string; wikidataId?: string; website?: string }, index: ResolveIndex, cfg: ScoutConfig): ResolveHit
  ```
  `ResolveIndex` is an in-memory list of `{ placeId, normalizedName, lat, lng, category, osmId?, wikidataId?, website? }` built from places already accepted in this run plus any loaded from `02-harvest` on resume. Rungs are spec §4: (1) exact placeId, (2) shared osm/wikidata/website domain, (3) same normalized name and distance < `matchDistanceM.sameName` (150), (4) JW ≥ `jaroWinkler.match` (0.88) and distance < `matchDistanceM.fuzzy` (300) and same `categoryGroup`, else if JW ≥ `jaroWinkler.ambiguous` (0.80) and distance < 300 or two rungs hit → `ambiguous`. New ids are assigned once and then only found via the ladder (the function checks the index before computing a fresh id).

- [ ] **Step 1: Tests with independent expected values**

`normalizeName("Ristorante Trattoria Sostanza!")` → `"sostanza"`. `normalizeName("Il Gelateria")` → `"gelateria"` is wrong — prefixes stripped are whole tokens only, so `"il gelateria"` → `"gelateria"`. `jaroWinkler("sostanza","sostanza")` → 1. `jaroWinkler("martha","marhta")` → 0.961 (standard published example). 

Dedupe fixture `dedupe-pairs.json`: 30 objects `{ left, right, expect: "match-rung-2"|"match-rung-3"|"match-rung-4"|"new"|"ambiguous" }` covering: same OSM id; same website domain `www.x.it` vs `x.it`; "Trattoria Sostanza" vs "Sostanza" 40 m apart; "Sostanza" vs "Sostanza" 2 km apart (new); JW 0.84 at 100 m (ambiguous); two museums 100 m apart with JW 0.9 (match-rung-4); a restaurant and a museum with the same name 50 m apart (ambiguous, different group). The test loads the file and asserts `resolvePlace` against `expect`. Expected verdicts are written in the JSON, not recomputed.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** Jaro–Winkler locally (prefix scale 0.1, max prefix 4). Geohash via `ngeohash.encode(lat, lng, 7)`. Distance via haversine in metres. Website domain: strip protocol and leading `www.`.

- [ ] **Step 4: Run** — PASS, including all 30 pairs.

- [ ] **Step 5: Commit** `feat(scout): entity resolution ladder and dedupe fixture`

---

### Task 6: Stage 2 harvest (Overpass, Wikidata, keep-rule, cap)

**Files:**
- Create: `apps/scout/src/stages/02-harvest.ts`, `02-harvest.test.ts`
- Create: `apps/scout/fixtures/tuscany-slice/overpass-florence.json`, `wikidata-florence.json`

**Interfaces:**
- Consumes: `ScoutConfig`, `BBox`, `openWork`, rate limiter, `isPublicIp` not needed here.
- Produces:
  ```ts
  const OVERPASS_GROUPS: readonly { id: string; query: (bbox: string) => string }[]   // 8 groups from spec §8.2
  interface OsmCandidate { osmType: "node"|"way"|"relation"; osmId: string; name: string; lat: number; lng: number; tags: Record<string, string> }
  function keepCandidate(el: OsmCandidate): boolean
  function rankCandidates(list: OsmCandidate[]): OsmCandidate[]
  async function harvestAreas(areas: { name: string; bbox: BBox }[], opts: { fetchImpl: typeof fetch; cacheDir: string; cfg: ScoutConfig }): Promise<{ kept: OsmCandidate[]; wikidata: Record<string, WikidataFacts> }>
  interface WikidataFacts { qid: string; label: string; description?: string; sitelinks: number; website?: string; image?: { url: string; licence: string; author: string } }
  ```

- [ ] **Step 1: Tests**

Keep-rule: a node with only `amenity=restaurant` and no name is dropped. A named restaurant with `website` is kept. `disused:amenity=restaurant` is dropped. `shop=vacant` is dropped. A named museum with `wikidata=Q123` is kept.

Query builder: `OVERPASS_GROUPS` has length 8; the food group's query contains `amenity~"restaurant|cafe|ice_cream|bar|pub|marketplace|theatre|arts_centre"` and the bbox.

Fixture file (write it in full, 12 elements, not 120): 8 keepers (museum with wikidata, restaurant with website, gelateria with opening_hours, viewpoint, bakery, winery, hotel, park) and 4 droppers (nameless cafe, vacant shop, disused museum, named restaurant with no quality tag). `harvestAreas` with injected fetch that returns the fixture, then a second call that must not hit the network (file cache). Wikidata fetch is only for elements with `wikidata=Q…`; the fixture's one QID returns label, description, sitelinks 20, P856, P18. Cap test: 5 candidates with `maxCandidates: 2` returns the two with wikidata/website first and marks the rest as not enriched (the function returns `{ kept, deferred }`).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

Overpass body is `[out:json][timeout:60];(node…;way…;relation…;);out center;`. Client posts to `cfg.overpass.endpoints[0]`, on non-200 tries the next, waits `minIntervalMs` between calls, writes `cacheDir/<area>-<group>.json`. Wikidata is `https://www.wikidata.org/wiki/Special:EntityData/<QID>.json` plus Commons `extmetadata` only when P18 is present. `opening_hours` stored raw; absence → later `hoursStatus: "unknown"`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(scout): overpass harvest, keep-rule, wikidata enrichment`

---

### Task 7: Stage 3 trend mining, search, fetch, quote verification

**Files:**
- Create: `apps/scout/src/stages/03-trends.ts`, `03-trends.test.ts`, `apps/scout/src/net/fetchPage.ts`, `fetchPage.test.ts`, `apps/scout/src/search/tavily.ts`, `tavily.test.ts`
- Create: `apps/scout/fixtures/pages/sorbettiera.html` and one `robots.txt` fixture

**Interfaces:**
- Consumes: `TrendsRequest`, `TrendFinding`, `ScoutConfig`, `assertPublicUrl`.
- Produces:
  ```ts
  function trendPacketsFor(areas: { name: string; lat: number; lng: number; kind: AreaKind; sitelinks: number; candidateCount: number }[], cfg: ScoutConfig, budget: { llmLeft: number; searchesLeft: number }): TrendsRequest[]
  interface SearchHit { url: string; title: string; rawContent?: string }
  interface SearchProvider { search(query: string): Promise<SearchHit[]> }
  function createTavilySearch(apiKey: string, fetchImpl: typeof fetch, cfg: ScoutConfig): SearchProvider
  async function fetchPage(url: string, opts: { fetchImpl: typeof fetch; cfg: ScoutConfig; lookup?: ... }): Promise<{ text: string; quoteAllowed: boolean } | { skipped: string }>
  function quoteVerified(quote: string, pageText: string): boolean
  ```

- [ ] **Step 1: Tests**

`trendPacketsFor`: a tier-1 area (sitelinks 50) yields one packet per theme (11). A tier-3 area yields only `food` and `hidden_gems`. With `searchesLeft: 4` and `searchesPerPacket: 2`, only 2 packets are returned (highest tier first). Each packet's `queries` has length ≤ 2.

`quoteVerified("hello world", "Hello   world!")` is true. A quote absent from the page is false.

`fetchPage`: `http://127.0.0.1/` returns `{ skipped: "ssrf" }` without calling fetch. A 3-byte body over `maxBytes: 2` returns `{ skipped: "too-large" }`. HTML containing `<meta name="robots" content="noai">` returns `quoteAllowed: false`. A normal page returns extracted text (use a tiny HTML string with a `<p>`). `User-Agent` on the request equals `cfg.fetch.userAgent`.

Tavily: injected fetch asserts the body has `include_raw_content: true`, `max_results` from config, and the API key is a header `Authorization: Bearer …`, never written into the returned hits.

Robots: a fixture `User-agent: * / Disallow: /private` makes `fetchPage` of `https://example.com/private/x` return `{ skipped: "robots" }`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

Tier assignment: tier 1 if sitelinks ≥ `tierRules.tier1.minSitelinks` or candidates ≥ `tierRules.tier1.minCandidates`; else tier 2 if the tier2 thresholds; else tier 3. Themes for tier 2/3 come from `cfg.tierThemes`. Packet id `trends-<n>` allocated by the caller later; this function returns `TrendsRequest[]` in tier order.

`fetchPage` checks SSRF, then `robots.txt` (cached per origin), then GET with `AbortSignal.timeout(cfg.fetch.timeoutMs)`, reads at most `maxBytes+1` bytes, uses `@mozilla/readability` + `linkedom` for HTML. `quoteVerified` lowercases and collapses whitespace on both strings.

`createTavilySearch` POSTs `https://api.tavily.com/search`. No grounding client in Part A beyond an interface `GroundingSearch` with the same `SearchProvider` shape and a test double; the live grounding adapter is a Part B note because it needs the Worker-side Gemini key path already used by `ModelRouter` — Part A ships Tavily only, and `GeminiBackend` (Task 10) calls `SearchProvider`. If Tavily returns non-200, the packet is skipped and the run records `errors[]`, it does not throw away the destination.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(scout): trend packets, page fetch, quote verification`

---

### Task 8: Enrichment packets, dwell bands, fame and trend scores

**Files:**
- Create: `apps/scout/src/stages/05-enrich.ts`, `05-enrich.test.ts`, `apps/scout/src/score.ts`, `score.test.ts`

**Interfaces:**
- Consumes: `EnrichCandidate`, `EnrichedPlace`, `dwellBandFor`, `PlaceCategory`, `DEFAULT_SCOUT_CONFIG`.
- Produces:
  ```ts
  function enrichPackets(candidates: EnrichCandidate[], cfg: ScoutConfig): { packetId: string; request: EnrichRequest }[]
  function validateEnrichment(request: EnrichRequest, places: EnrichedPlace[], cfg: ScoutConfig): ValidationResult<EnrichedPlace[]>
  function fameScore(input: { sitelinks: number; sourcesCount: number; completeness: number }, cfg: ScoutConfig): number
  function trendScore(evidence: { platform: Platform; monthsOld: number | null; quoteVerified: boolean }[], cfg: ScoutConfig): number
  function completenessOf(place: { openingHours?: string; website?: string; wikidataId?: string; image?: unknown; description?: string }): number
  ```

- [ ] **Step 1: Tests with literals from spec §8.8**

`fameScore({ sitelinks: 0, sourcesCount: 0, completeness: 0 })` → 0. `fameScore({ sitelinks: 9, sourcesCount: 5, completeness: 1 })` → `clamp(25*log10(10) + 8*5 + 20*1)` = 85 (assert `toBeCloseTo(85, 5)`). Three verified TikTok mentions at `monthsOld: 0` → `3 * 1.5 * 1 * 20` = 90. An unverified quote adds 0. A mention 24 months old adds 0. `monthsOld: null` uses `unknownDateRecency` (0.5).

`enrichPackets` of 31 candidates with `enrichBatchSize: 30` returns 2 packets; every candidate id appears once. `validateEnrichment` rejects a response that omits an id, adds an id, or sets `dwellMin: 10` for `culture.museum` (band 60–240) with reason `dwell implausible for category`. A dwell inside the band passes.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the formulas exactly as spec §8.8: `clamp(0, 100, 25*log10(1+sitelinks) + 8*min(sources, cap) + 20*completeness)` and `clamp(0, 100, sum(weight * max(0, 1 - months/recencyMonths)) * trendScale)`. Completeness is the fraction of the five fields in §8.8.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(scout): enrichment validation and fame/trend scores`

---

### Task 9: Stays packets

**Files:**
- Create: `apps/scout/src/stages/06-stays.ts`, `06-stays.test.ts`

**Interfaces:**
- Produces: `function staysPackets(areas: { name, lat, lng, kind }[], accommodations: { name, lat, lng, tourism, website? }[], cfg): { packetId: string; request: StaysRequest }[]` and `function validateStays(raw: unknown): ValidationResult<StaysResponse>` using `StaysResponseSchema`. Accommodations are those harvest candidates whose `tourism` is hotel/guest_house/apartment/hostel/chalet, grouped to the nearest area centre within that area's radius.

- [ ] **Step 1: Test** — a hotel 1 km from Florence is included in Florence's packet; a hotel 50 km away is not. A response with 0 zones fails the schema (min 1). A response with 5 example properties fails (max 5 per zone, schema max). Extra field `secret` is rejected (`strictObject`).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** grouping by haversine against `areaRadiusKm`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(scout): stays packets`

---

### Task 10: IntelligenceBackend — fake, Gemini, agent

**Files:**
- Create: `apps/scout/src/backend/types.ts`, `fake.ts`, `gemini.ts`, `gemini.test.ts`, `agent.ts`, `agent.test.ts`
- Create: `packages/domain/prompts/scout/areas.md`, `trends.md`, `enrich.md`, `stays.md` (full prompt text, not a stub)

**Interfaces:**
- Consumes: `ModelRouter.run(task, req)` from `@wayfare/providers` (verify the signature in `packages/providers/src/llm/router.ts` at execution time; Task 5 named it `run`, not `complete`). `validatePacketResponse`, `packetJsonSchema`, `PacketRequestFileSchema` (Task 2). `LlmError`.
- Produces:
  ```ts
  interface IntelligenceBackend {
    readonly id: "fake" | "gemini" | "agent";
    listAreas(req: AreasRequest): Promise<AreasResponse>;
    extractTrends(req: TrendsRequest, pages: { url: string; text: string }[]): Promise<TrendsResponse>;
    enrichBatch(req: EnrichRequest): Promise<EnrichResponse>;
    suggestStays(req: StaysRequest): Promise<StaysResponse>;
  }
  function createFakeBackend(answers: Record<string, unknown>): IntelligenceBackend
  function createGeminiBackend(opts: { router: ModelRouter; search: SearchProvider; fetchPage: typeof fetchPage; budget: { llmCalls: number; searches: number }; limits: { llm: number; searches: number } }): IntelligenceBackend
  function createAgentBackend(opts: { packetsDir: string; readFile: typeof readFileSync; writeFile: typeof writeFileSync }): IntelligenceBackend
  ```

Prompt files: each is the system instruction for that packet. `trends.md` states the hard rules from Appendix A (verbatim quote, real URL, empty findings allowed, no invented coordinates). `enrich.md` states echo-id, taxonomy, dwell bands, local-form names. `areas.md` states 8–16 areas inside the bbox. `stays.md` states 1–4 zones, 1–5 example properties.

- [ ] **Step 1: Tests**

Gemini: a fake `ModelRouter` whose `run` returns JSON text for an areas response. Assert `run` was called with `task: "extract"`. Assert `jsonSchema` is set when the chosen model is not our concern — the backend passes `jsonSchema: packetJsonSchema("areas")` and, if `router.run` throws `LlmError` kind `invalid_request`, it retries once with the schema appended to the system prompt and `jsonSchema` omitted (the Task 5 note: some `:free` models reject `strict`). Budget: the 81st LLM call throws a typed `BudgetExceeded` and does not call `run`. Search: `extractTrends` calls `search` at most `searchesPerPacket` times and concatenates page text truncated to `extractMaxChars`.

Agent: write a response file, call `listAreas`, get the parsed body. Write a response that fails schema, assert the thrown error lists reasons and a `*.rejected.json` was written whose `attempts.length` is 1. After three failed attempts, `listAreas` throws `RejectionsExceeded` (exit code 5 is the CLI's job in Task 11). A response path containing `..` is refused before read. Provenance helper `agentProvenance(packetId)` returns `{ backend: "agent", model: "cursor-agent", packetIds: [packetId] }`.

Fake: returns the recorded object for the packet type.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the three backends. Gemini parses `result.text` with the response schema; on parse failure it counts as an LLM call and throws `LlmError("other")` so the CLI can record it. Agent writes `*.request.json` if not present (instructions = the prompt file, schema = `packetJsonSchema`, payload = the request), then reads `*.response.json`. Missing response → throw `AwaitingPackets` (the CLI maps this to exit 3).

- [ ] **Step 4: Run** — PASS. Also grep `work/` is not applicable yet; add a test that `PacketRequestFileSchema` output of the agent backend contains no string matching `/AIza|sk-or-|tvly-|private_key|GEMINI_API_KEY/`.

- [ ] **Step 5: Commit** `feat(scout): fake, gemini and agent intelligence backends`

---

### Task 11: Wire stages 1, 4 and the dry-run writer; `--report`; `--dedupe`; end-to-end

**Files:**
- Create: `apps/scout/src/stages/01-areas.ts`, `04-resolve.ts`, `07-writeDry.ts`, `apps/scout/src/pipeline.ts`, `pipeline.test.ts`, `apps/scout/src/report.ts`, `report.test.ts`, `apps/scout/src/lock.ts`, `lock.test.ts`
- Modify: `apps/scout/src/cli.ts` to call `runPipeline`

**Interfaces:**
- Consumes: every producer from Tasks 3–10.
- Produces:
  ```ts
  interface PipelineOptions { repoRoot: string; slug: string; backend: IntelligenceBackend; cfg: ScoutConfig; dryRun: true; now: () => Date; budget: { llm: number; searches: number } }
  async function runPipeline(opts: PipelineOptions): Promise<{ exitCode: 0|3|4|5; outDir: string }>
  function renderReport(summary: { places: number; trendingVerified: number; rejected: number; pendingMerges: number; budget: { llmCalls: number; searches: number } }): string
  function acquireLock(workRoot: string, runId: string, now: Date, staleHours: number, force: boolean): void   // throws if a fresh lock exists
  ```

Dry-run writes `work/<slug>/out/places.json`, `evidence.json`, `pack.json`, `stayAreas.json`, `run-report.md`. It does not import Firestore. `places.json` items use `effectivePlace` (no overrides in Part A, so it equals the base). `placeId` comes only from `resolvePlace`. Evidence id is `sha1(url|normalisedQuote)`.

- [ ] **Step 1: End-to-end test**

Use the Florence harvest fixture plus a `FakeBackend` that returns one area (Florence), one trend finding whose quote is present in `fixtures/pages/sorbettiera.html`, one enrichment for every kept candidate, and one stay zone. Run `runPipeline` in a temp repo root. Assert exit 0; `places.json` has one place per keeper; the gelateria's evidence has `quoteVerified: true`; a second `runPipeline` on the same work dir does not change place ids (idempotent); a duplicate "Sostanza" / "Trattoria Sostanza" pair in the fixture produces one place plus either a match or a `pendingMerges` entry, never two active places with the same normalized name within 150 m.

Lock test: a lock file dated now makes a second acquire throw; a lock older than `lockStaleHours` is replaced; `force: true` replaces a fresh lock.

Report test: `renderReport` includes the five numbers it was given (literals, not recomputed).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** stage order 1 → 2 → 3 → 4 → 5 → 6 → 7. Stage 3 builds packets via `trendPacketsFor`, calls `extractTrends`, then `fetchPage` on each `sourceUrl` (FakeBackend's URLs point at the fixture by injecting `fetchPage`). Stage 4 geocodes only candidates that lack lat/lng (harvest already has them). `AwaitingPackets` → return exit 3. `BudgetExceeded` → exit 4. `RejectionsExceeded` → exit 5.

`cli.ts`: `--status` prints `formatStatus` and exits 0. `--report` prints `run-report.md` if present, else exit 2. `--dedupe` reads `out/places.json` and writes `out/pending-merges.json`. `--backend gemini` without `GEMINI_API_KEY` or `TAVILY_API_KEY` exits 2 before constructing the backend.

- [ ] **Step 4: Run** `pnpm --filter @wayfare/scout test && pnpm --filter @wayfare/domain test && pnpm lint:fix && pnpm lint && pnpm typecheck` — PASS.

- [ ] **Step 5: Commit** `feat(scout): dry-run pipeline, report, lock, dedupe sweep`

---

### Task 12: Skill, `scout.bat`, manual workflow, agent-protocol test

**Files:**
- Create: `.cursor/skills/scout-destination/SKILL.md`
- Create: `scout.bat`
- Create: `.github/workflows/scout.yml`
- Create: `apps/scout/src/backend/agentProtocol.test.ts`

**Interfaces:**
- Consumes: Appendix A of the Phase 1 spec (copy verbatim into the skill). CLI from Task 11.

- [ ] **Step 1: Protocol test** (this is the failing test; the skill and workflow have no runtime test beyond a YAML parse)

`agentProtocol.test.ts` creates a temp `packets/` dir, writes one `areas-1.request.json` using `PacketRequestFileSchema`, writes a response missing `why`, runs the agent backend `listAreas`, expects a rejection file, writes a corrected response, expects a parsed `AreasResponse`. Assert the request JSON string does not contain `GEMINI_API_KEY` or `AIza`.

- [ ] **Step 2: Run** — FAIL until `createAgentBackend` is wired as in Task 10 (it should already pass if Task 10 landed; if it passes immediately, keep the test — it is the seam for the agent path).

- [ ] **Step 3: Skill and scripts**

Copy Appendix A of `docs/superpowers/specs/2026-09-21-phase-1-scouting-design.md` into `.cursor/skills/scout-destination/SKILL.md` unchanged, including the frontmatter `name` and `description`.

`scout.bat` (CRLF, same colour header as `dev.bat`): flags `--backend agent|gemini` (default `agent`), `--dry-run`, `--status`, `--report`, `--dedupe`, destination slug as the first argument. Preflight: `node` and `pnpm` on PATH. For `--backend gemini`, if `.env` lacks `GEMINI_API_KEY` or `TAVILY_API_KEY`, print `[ERROR]` and exit 2. Then `call pnpm scout -- %*`. Do not start emulators.

`.github/workflows/scout.yml`:
```yaml
name: scout
on:
  workflow_dispatch:
    inputs:
      destinations:
        description: "Comma-separated slugs"
        required: true
        type: string
      backend:
        description: "gemini only"
        required: true
        default: gemini
        type: choice
        options: [gemini]
jobs:
  scout:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: ".nvmrc" }
      - run: corepack enable && pnpm install --frozen-lockfile
      - name: Refuse agent backend
        if: inputs.backend != 'gemini'
        run: exit 1
      - run: pnpm scout ${{ inputs.destinations }} --backend gemini
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          TAVILY_API_KEY: ${{ secrets.TAVILY_API_KEY }}
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
```
No `schedule:` key. The live Firestore write is a no-op until Part B's stage 7; until then the workflow still runs the dry pipeline if `--dry-run` is added by Part B. Part A workflow runs `pnpm scout <slug> --backend gemini --dry-run` so it cannot fail for lack of Firestore. Change the run line above to append `--dry-run` and add a comment `Part B removes --dry-run once stage 7 writes Firestore`.

Verify `scout.bat` is CRLF: a Node script prints `crlf` or fails the task. `git ls-files --eol -- scout.bat` shows `crlf`.

- [ ] **Step 4: Run** the protocol test, lint, typecheck — PASS. Run `cmd /c "scout.bat --status nosuch"` and expect exit 2 (unknown destination / no work dir) without network.

- [ ] **Step 5: Commit** only `apps/scout/src/backend/agentProtocol.test.ts`, `.cursor/skills/scout-destination/SKILL.md`, `scout.bat`, `.github/workflows/scout.yml`. Message: `feat(scout): destination skill, scout.bat, manual workflow`. Confirm `git check-ignore -q .cursor/skills/scout-destination/SKILL.md` is exit 1 (not ignored).

---

## Part B (appended after Phase 0 Task 12 lands)

Titles only. Each depends on the named Phase 0 task. Do not implement from this list.

1. Extract `FirestoreClient` from `apps/api` into `packages/firestore` — depends on Task 9.
2. Stage 7 live writer (upserts, evidence ids, `lastSeenRunId`, `notSeenSince`, run lock in Firestore, quota pre-check) — depends on B1 and Task 9.
3. Admin Worker routes `/admin/scout/*`, `/admin/places/*`, `/admin/merges/*`, `/admin/reviews/*` with `requireAdmin` and fresh re-auth — depends on Task 8.
4. Rules for `destinations`, `places` private notes, `pendingMerges`, `scoutRuns`, `reviewSessions` — depends on Task 11.
5. Admin web: Scouting tab, Places table, edit drawer, Review mode, Merge queue — depends on Task 12.
6. `GITHUB_DISPATCH_TOKEN` and the "Run with Gemini" button — depends on B3 and Task 6.
7. Independent security review of Phase 1 — depends on B1–B6.

## Self-review

Spec §1–§4, §8 and Appendix A are covered by Tasks 1–12. Firestore writes, admin UI, rules and the security review are explicitly Part B, not dropped. No schedule is present. Packet schema names in Tasks 7–12 match Task 2. `ModelRouter.run` matches Task 5. Placeholders: none. The 12-element harvest fixture replaces a 120-element dump on purpose: every keep and drop rule has a row, and the live query is the same code path. Grounding search is an interface only; Tavily is the Part A implementation, matching the spec's primary.
