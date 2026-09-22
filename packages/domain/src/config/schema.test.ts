import { AppConfigSchema, DEFAULT_CONFIG, DEFAULT_SCOUT_CONFIG, ScoutConfigSchema } from "./schema";

test("default config validates", () => {
  expect(AppConfigSchema.parse(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
});

test("free tier has one lifetime generation and 2 refine iterations; plus has 3", () => {
  expect(DEFAULT_CONFIG.tiers.free.lifetimeGenerations).toBe(1);
  expect(DEFAULT_CONFIG.tiers.free.refineIterations).toBe(2);
  expect(DEFAULT_CONFIG.tiers.plus.refineIterations).toBe(3);
});

test("negative caps are rejected", () => {
  const bad = {
    ...DEFAULT_CONFIG,
    pace: { ...DEFAULT_CONFIG.pace, chill: { ...DEFAULT_CONFIG.pace.chill, activeHours: -1 } },
  };
  expect(() => AppConfigSchema.parse(bad)).toThrow();
});

test("admin fresh-auth window is 15 minutes", () => {
  expect(DEFAULT_CONFIG.admin.freshAuthMaxAgeSec).toBe(15 * 60);
});

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
    "food",
    "dessert",
    "cafe_breakfast",
    "wine",
    "viewpoint_photo",
    "hidden_gems",
    "culture",
    "nightlife",
    "shopping",
    "family",
    "nature_active",
  ]);
  for (const t of s.themes) expect(t.queries).toHaveLength(2);
  expect(s.tierThemes.tier2).toEqual([
    "food",
    "dessert",
    "hidden_gems",
    "viewpoint_photo",
    "culture",
  ]);
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
