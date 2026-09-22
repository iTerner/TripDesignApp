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
  expect(() =>
    TrendsResponseSchema.parse({ findings: [{ ...finding, sourceUrl: "ftp://x" }] }),
  ).toThrow();
  expect(() =>
    TrendsResponseSchema.parse({ findings: [{ ...finding, approxDate: "May 2026" }] }),
  ).toThrow();
  expect(() =>
    TrendsResponseSchema.parse({ findings: [{ ...finding, category: "food.gelato" }] }),
  ).toThrow();
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
  expect(() =>
    EnrichResponseSchema.parse({ places: [{ ...enriched, bestTimeOfDay: ["dawn"] }] }),
  ).toThrow();
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
    exampleProperties: [
      { name: "Hotel Palazzo Guadagni", website: "https://example.com", priceLevel: 3 },
    ],
  };
  expect(StaysResponseSchema.parse({ zones: [zone] }).zones).toHaveLength(1);
  expect(() => StaysResponseSchema.parse({ zones: [] })).toThrow();
  expect(() => StaysResponseSchema.parse({ zones: Array(5).fill(zone) })).toThrow();
  expect(() =>
    StaysResponseSchema.parse({ zones: [{ ...zone, exampleProperties: [] }] }),
  ).toThrow();
});

test("packet ids follow <type>-<n>; traversal and other names are rejected", () => {
  expect(PACKET_ID_PATTERN.test("trends-07")).toBe(true);
  expect(PacketIdSchema.parse("enrich-12")).toBe("enrich-12");
  for (const bad of [
    "../areas-1",
    "areas-1/../x",
    "areas",
    "areas-",
    "areas-1.response",
    "AREAS-1",
  ]) {
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
