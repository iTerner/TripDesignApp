import {
  DEFAULT_SCOUT_CONFIG,
  type EnrichCandidate,
  type EnrichedPlace,
  EnrichRequestSchema,
  type PlaceCategory,
  SELECTABLE_CATEGORIES,
} from "@wayfare/domain";
import { enrichPackets, validateEnrichment } from "./05-enrich";

function candidate(n: number): EnrichCandidate {
  const id = `pl_${String(n).padStart(2, "0")}`;
  return {
    id,
    name: `Place ${id}`,
    lat: 43.77,
    lng: 11.25,
    osmTags: { tourism: "museum" },
  };
}

function place(id: string, primaryCategory: PlaceCategory, dwellMin: number): EnrichedPlace {
  return {
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
    blurb: "A local place.",
  };
}

test("enrichPackets splits 31 candidates into batches of enrichBatchSize 30", () => {
  const candidates = Array.from({ length: 31 }, (_, i) => candidate(i + 1));
  const cfg = { ...DEFAULT_SCOUT_CONFIG, enrichBatchSize: 30 };
  const packets = enrichPackets(candidates, cfg);

  expect(packets).toHaveLength(2);
  expect(packets.map((p) => p.packetId)).toEqual(["enrich-1", "enrich-2"]);
  expect(packets[0]?.request.candidates).toHaveLength(30);
  expect(packets[1]?.request.candidates).toHaveLength(1);

  const ids = packets.flatMap((p) => p.request.candidates.map((c) => c.id));
  expect(ids).toEqual(candidates.map((c) => c.id));
  expect(new Set(ids).size).toBe(ids.length);

  for (const packet of packets) {
    expect(EnrichRequestSchema.safeParse(packet.request).success).toBe(true);
    expect(packet.request.taxonomy).toEqual([...SELECTABLE_CATEGORIES]);
    expect(packet.request.dwellBands["culture.museum"]).toEqual([60, 240]);
  }
});

test("validateEnrichment rejects a missing id, an extra id, and an implausible dwell", () => {
  const cfg = DEFAULT_SCOUT_CONFIG;
  const request = {
    candidates: [candidate(1), candidate(2)],
    taxonomy: [...SELECTABLE_CATEGORIES],
    dwellBands: cfg.dwellBands,
  };

  const missing = validateEnrichment(request, [place("pl_01", "culture.museum", 90)], cfg);
  expect(missing.ok).toBe(false);
  if (!missing.ok) {
    expect(missing.reasons).toEqual([{ path: "places", reason: "missing id pl_02" }]);
  }

  const extra = validateEnrichment(
    request,
    [
      place("pl_01", "culture.museum", 90),
      place("pl_02", "culture.museum", 90),
      place("pl_99", "culture.museum", 90),
    ],
    cfg,
  );
  expect(extra.ok).toBe(false);
  if (!extra.ok) {
    expect(extra.reasons).toEqual([{ path: "places.2.id", reason: "unknown id" }]);
  }

  const dwell = validateEnrichment(
    request,
    [place("pl_01", "culture.museum", 10), place("pl_02", "culture.museum", 90)],
    cfg,
  );
  expect(dwell.ok).toBe(false);
  if (!dwell.ok) {
    expect(dwell.reasons).toEqual([
      {
        path: "places.0.dwellMin",
        reason: "dwell implausible for category (culture.museum expects 60–240)",
      },
    ]);
  }

  const duplicate = validateEnrichment(
    request,
    [place("pl_01", "culture.museum", 90), place("pl_01", "culture.museum", 90)],
    cfg,
  );
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) {
    expect(duplicate.reasons).toEqual([
      { path: "places.1.id", reason: "duplicate id" },
      { path: "places", reason: "missing id pl_02" },
    ]);
  }

  // 50 is inside the food group (30–180) and outside food.dessert (10–40).
  // 45 is inside the culture group (30–240) and outside culture.museum (60–240).
  const categoryBand = validateEnrichment(
    request,
    [place("pl_01", "food.dessert", 50), place("pl_02", "culture.museum", 45)],
    cfg,
  );
  expect(categoryBand.ok).toBe(false);
  if (!categoryBand.ok) {
    expect(categoryBand.reasons).toEqual([
      {
        path: "places.0.dwellMin",
        reason: "dwell implausible for category (food.dessert expects 10–40)",
      },
      {
        path: "places.1.dwellMin",
        reason: "dwell implausible for category (culture.museum expects 60–240)",
      },
    ]);
  }

  const ok = validateEnrichment(
    request,
    [place("pl_01", "food.dessert", 10), place("pl_02", "culture.museum", 60)],
    cfg,
  );
  expect(ok.ok).toBe(true);
  if (ok.ok) {
    expect(ok.data.map((p) => p.id)).toEqual(["pl_01", "pl_02"]);
  }
});
