import { z } from "zod";
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
    {
      id: "cafe_breakfast",
      queries: ["best cafe breakfast {area} {year}", "{area} coffee instagram"],
    },
    { id: "wine", queries: ["best wine tasting {area} {year}", "{area} winery visit reddit"] },
    {
      id: "viewpoint_photo",
      queries: ["{area} best photo spots {year}", "{area} viewpoint instagram"],
    },
    {
      id: "hidden_gems",
      queries: ["{area} hidden gems reddit", "{area} off the beaten path {year}"],
    },
    {
      id: "culture",
      queries: ["{area} museums worth visiting {year}", "{area} exhibition {year}"],
    },
    { id: "nightlife", queries: ["{area} best bars {year}", "{area} aperitivo TikTok"] },
    { id: "shopping", queries: ["{area} artisan shops {year}", "{area} market shopping guide"] },
    { id: "family", queries: ["{area} with kids {year}", "{area} family activities reddit"] },
    {
      id: "nature_active",
      queries: ["{area} hikes walks {year}", "{area} outdoor activities instagram"],
    },
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
    userAgent:
      "WayfareScout/0.1 (trip-planner place scouting; manual runs; contact: see repo README)",
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
  dwellBands: DEFAULT_DWELL_BANDS as ScoutConfig["dwellBands"],
  firestore: { batchSize: 500, dailyWriteQuota: 20_000, maxQuotaFraction: 0.6 },
};

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
  scout: ScoutConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Spec §3.5, §1.4, §7 defaults. Admin-tunable at runtime (config/current) in later phases. */
export const DEFAULT_CONFIG: AppConfig = {
  version: 2,
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
  engine: {
    shortlistSize: 180,
    fastPackTargetPlaces: 250,
    dayTripRadiusMin: 90,
    scoutingUsesBestChain: false,
  },
  admin: { freshAuthMaxAgeSec: 15 * 60 },
  scout: DEFAULT_SCOUT_CONFIG,
};
