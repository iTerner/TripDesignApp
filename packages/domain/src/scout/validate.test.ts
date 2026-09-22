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
const area = (name: string, lat: number, lng: number) => ({
  name,
  lat,
  lng,
  why: "w",
  kind: "town" as const,
});

test("areas: too few, outside bbox, duplicate names", () => {
  const ok = validatePacketResponse("areas", areasReq, {
    areas: [area("Florence", 43.77, 11.25), area("Siena", 43.32, 11.33)],
  });
  expect(ok.ok).toBe(true);
  const few = validatePacketResponse("areas", areasReq, {
    areas: [area("Florence", 43.77, 11.25)],
  });
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
    {
      id: "pl_b",
      name: "Gelateria La Carraia",
      lat: 43.76,
      lng: 11.24,
      osmTags: { amenity: "ice_cream" },
    },
  ],
  taxonomy: [...SELECTABLE_CATEGORIES],
  dwellBands: Object.fromEntries(
    Object.entries(DEFAULT_DWELL_BANDS).map(([k, v]) => [k, [v[0], v[1]]]),
  ),
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
      {
        path: "places.0.dwellMin",
        reason: "dwell implausible for category (culture.museum expects 60–240)",
      },
      {
        path: "places.1.dwellMin",
        reason: "dwell implausible for category (food.dessert expects 10–40)",
      },
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
  const zone = {
    name: "Oltrarno",
    rationale: "r",
    exampleProperties: [{ name: "H", priceLevel: 2 }],
  };
  const req = {
    area: { name: "Florence", lat: 43.7, lng: 11.2, kind: "town" as const },
    accommodations: [],
    areaFacts: [],
  };
  const r = validatePacketResponse("stays", req, { zones: [zone, { ...zone, name: "oltrarno" }] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reasons[0]?.reason).toMatch(/duplicate zone/);
});
