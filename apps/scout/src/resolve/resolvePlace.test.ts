import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_SCOUT_CONFIG, type PlaceCategory } from "@wayfare/domain";
import { normalizeName } from "./normalize";
import { placeIdFor } from "./placeId";
import { type IndexedPlace, type ResolveHit, resolvePlace } from "./resolvePlace";

type Side = {
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  osmId?: string;
  wikidataId?: string;
  website?: string;
};

type Pair = {
  left: Side;
  right: Side;
  expect: "match-rung-2" | "match-rung-3" | "match-rung-4" | "new" | "ambiguous";
};

const EXPECTED = ["match-rung-2", "match-rung-3", "match-rung-4", "new", "ambiguous"] as const;

function loadPairs(): Pair[] {
  const path = fileURLToPath(new URL("../../fixtures/dedupe-pairs.json", import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("dedupe fixture is not an array");
  return parsed.map((row) => {
    if (typeof row !== "object" || row === null) throw new Error("dedupe row is not an object");
    const record = row as { left?: unknown; right?: unknown; expect?: unknown };
    if (!isSide(record.left) || !isSide(record.right)) throw new Error("dedupe side is invalid");
    if (typeof record.expect !== "string" || !EXPECTED.includes(record.expect as Pair["expect"])) {
      throw new Error(`dedupe expect is invalid: ${String(record.expect)}`);
    }
    return { left: record.left, right: record.right, expect: record.expect as Pair["expect"] };
  });
}

function isSide(value: unknown): value is Side {
  if (typeof value !== "object" || value === null) return false;
  const side = value as Record<string, unknown>;
  if (typeof side.name !== "string" || side.name.length === 0) return false;
  if (typeof side.lat !== "number" || typeof side.lng !== "number") return false;
  if (typeof side.category !== "string" || !side.category.includes(".")) return false;
  if (side.osmId !== undefined && typeof side.osmId !== "string") return false;
  if (side.wikidataId !== undefined && typeof side.wikidataId !== "string") return false;
  if (side.website !== undefined && typeof side.website !== "string") return false;
  return true;
}

function withOptionals(side: Side): Side {
  const copy: Side = {
    name: side.name,
    lat: side.lat,
    lng: side.lng,
    category: side.category,
  };
  if (side.osmId !== undefined) copy.osmId = side.osmId;
  if (side.wikidataId !== undefined) copy.wikidataId = side.wikidataId;
  if (side.website !== undefined) copy.website = side.website;
  return copy;
}

function indexedFrom(side: Side, placeId: string): IndexedPlace {
  const copy = withOptionals(side);
  const entry: IndexedPlace = {
    placeId,
    normalizedName: normalizeName(copy.name),
    lat: copy.lat,
    lng: copy.lng,
    category: copy.category,
  };
  if (copy.osmId !== undefined) entry.osmId = copy.osmId;
  if (copy.wikidataId !== undefined) entry.wikidataId = copy.wikidataId;
  if (copy.website !== undefined) entry.website = copy.website;
  return entry;
}

const pairs = loadPairs();

test("dedupe fixture has 30 written verdicts", () => {
  expect(pairs).toHaveLength(30);
  for (const verdict of EXPECTED) {
    expect(pairs.some((pair) => pair.expect === verdict)).toBe(true);
  }
});

test.each(pairs.map((pair, index) => ({ index, pair })))(
  "pair $index resolves to $pair.expect",
  ({ index, pair }) => {
    const storedId = `pl_pair_${index}`;
    const hit = resolvePlace(
      withOptionals(pair.left),
      [indexedFrom(pair.right, storedId)],
      DEFAULT_SCOUT_CONFIG,
    );
    expect(verdictOf(hit, storedId, pair)).toBe(pair.expect);
  },
);

function verdictOf(hit: ResolveHit, storedId: string, pair: Pair): Pair["expect"] {
  if (hit.kind === "match") {
    expect(hit.placeId).toBe(storedId);
    if (hit.rung === 2) return "match-rung-2";
    if (hit.rung === 3) return "match-rung-3";
    if (hit.rung === 4) return "match-rung-4";
    throw new Error(`unexpected rung ${hit.rung}`);
  }
  if (hit.kind === "new") {
    expect(hit.placeId).toBe(
      placeIdFor(normalizeName(pair.left.name), pair.left.lat, pair.left.lng),
    );
    expect(hit.placeId).not.toBe(storedId);
    return "new";
  }
  expect(hit.candidates).toEqual([storedId]);
  expect(hit.score).toBeGreaterThanOrEqual(DEFAULT_SCOUT_CONFIG.jaroWinkler.ambiguous);
  return "ambiguous";
}

test("exact stored placeId matches on rung 1", () => {
  const id = placeIdFor("sostanza", 43.77, 11.25);
  const hit = resolvePlace(
    { name: "Sostanza", lat: 43.77, lng: 11.25, category: "food.restaurant" },
    [
      {
        placeId: id,
        normalizedName: "sostanza",
        lat: 43.77,
        lng: 11.25,
        category: "food.restaurant",
      },
    ],
    DEFAULT_SCOUT_CONFIG,
  );
  expect(hit).toEqual({ kind: "match", rung: 1, placeId: id });
});

test("a shared external id returns the stored placeId", () => {
  const hit = resolvePlace(
    {
      name: "Other Name",
      lat: 43.77,
      lng: 11.25,
      category: "food.restaurant",
      osmId: "node/9",
    },
    [
      {
        placeId: "pl_stored",
        normalizedName: "different",
        lat: 48.2,
        lng: 16.37,
        category: "culture.museum",
        osmId: "node/9",
      },
    ],
    DEFAULT_SCOUT_CONFIG,
  );
  expect(hit).toEqual({ kind: "match", rung: 2, placeId: "pl_stored" });
});

test("two indexed places on the same rung are ambiguous", () => {
  const hit = resolvePlace(
    { name: "Sostanza", lat: 43.7701798643, lng: 11.25, category: "food.restaurant" },
    [
      {
        placeId: "pl_a",
        normalizedName: "sostanza",
        lat: 43.77,
        lng: 11.25,
        category: "food.restaurant",
      },
      {
        placeId: "pl_b",
        normalizedName: "sostanza",
        lat: 43.7700899322,
        lng: 11.25,
        category: "food.restaurant",
      },
    ],
    DEFAULT_SCOUT_CONFIG,
  );
  expect(hit).toEqual({ kind: "ambiguous", candidates: ["pl_a", "pl_b"], score: 1 });
});
