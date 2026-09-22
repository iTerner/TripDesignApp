import { type Place, PlaceSchema } from "@wayfare/domain";
import { placeMatches } from "./placeFilters";

function place(patch: Partial<Place> = {}): Place {
  return PlaceSchema.parse({
    id: "pl_1",
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
    fameScore: 55,
    trendScore: 0,
    sources: [],
    source: "scout",
    runId: "run_1",
    packetIds: [],
    aliases: [],
    externalIds: {},
    verification: { geocoded: true, sourcesCount: 0, quoteVerified: false },
    adminOverrides: {},
    status: "active",
    firstSeenAt: "2026-09-21T10:00:00.000Z",
    lastSeenRunId: "run_1",
    timesFlagged: 0,
    ...patch,
  });
}

test("possibly closed means notSeenSince is set", () => {
  const open = place();
  const closed = place({ notSeenSince: "2026-09-22T00:00:00.000Z" });
  expect(placeMatches(open, { possiblyClosed: true })).toBe(false);
  expect(placeMatches(closed, { possiblyClosed: true })).toBe(true);
  expect(placeMatches(closed, {})).toBe(true);
});

test("has-override and has-trend skip places that lack them", () => {
  const plain = place();
  const edited = place({
    trendScore: 12,
    adminOverrides: {
      dwellMin: { value: 30, by: "admin", at: "2026-09-21T11:00:00.000Z" },
    },
  });
  expect(placeMatches(plain, { hasOverride: true })).toBe(false);
  expect(placeMatches(plain, { hasTrend: true })).toBe(false);
  expect(placeMatches(edited, { hasOverride: true, hasTrend: true })).toBe(true);
  expect(placeMatches(plain, { area: "Rome" })).toBe(false);
  expect(placeMatches(plain, { area: "Florence" })).toBe(true);
});
