import {
  DestinationSchema,
  EvidenceSchema,
  effectivePlace,
  PendingMergeSchema,
  PlaceSchema,
  ReviewSessionSchema,
  ScoutRunSchema,
} from "./documents";

const basePlace = () =>
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
      id: "pm1",
      destSlug: "tuscany",
      placeIdA: "a",
      placeIdB: "b",
      score: 0.85,
      reasons: ["jw 0.85", "distance 120m"],
      status: "open",
    }).status,
  ).toBe("open");
  expect(
    ScoutRunSchema.parse({
      runId: "run_1",
      destSlug: "tuscany",
      backend: "agent",
      startedBy: "cursor",
      startedAt: "2026-09-21T10:00:00.000Z",
      stages: {},
      budget: { llmCalls: 0, searches: 0 },
      rejectedPackets: [],
      errors: [],
    }).startedBy,
  ).toBe("cursor");
  expect(
    ReviewSessionSchema.parse({
      id: "rs1",
      destSlug: "tuscany",
      runId: "run_1",
      sample: [{ placeId: "a", bucket: "random" }],
      verdicts: { a: "correct" },
      accuracy: 1,
      startedAt: "2026-09-21T10:00:00.000Z",
    }).accuracy,
  ).toBe(1);
  expect(
    DestinationSchema.parse({
      slug: "tuscany",
      name: "Tuscany",
      kind: "region",
      geometry: {
        bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 },
        center: { lat: 43.4, lng: 11.1 },
      },
      queueOrder: 1,
      status: "queued",
      requestedBy: "admin",
      counts: { scouted: 0, userFound: 0, trending: 0, hidden: 0 },
    }).kind,
  ).toBe("region");
});
