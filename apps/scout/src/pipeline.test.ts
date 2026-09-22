import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BBox,
  DEFAULT_SCOUT_CONFIG,
  dwellBandFor,
  type EnrichedPlace,
  type PlaceCategory,
  type ScoutConfig,
} from "@wayfare/domain";
import { createFakeBackend } from "./backend/fake";
import { AwaitingPackets, BudgetExceeded, RejectionsExceeded } from "./backend/types";
import { runPipeline } from "./pipeline";
import { normalizeName } from "./resolve/normalize";

const FLORENCE: BBox = { south: 43.72, west: 11.15, north: 43.83, east: 11.33 };
const QUOTE =
  "Gelateria La Sorbettiera in Florence went viral on TikTok this spring for its pistachio and fig sorbet.";
const SOURCE_URL = "https://fixture.example/pages/sorbettiera.html";
const NOW = new Date("2026-09-22T12:00:00.000Z");

const HARVEST_KEEPERS = [
  "Boboli",
  "Castello di Verrazzano",
  "Forno Ghibellina",
  "Gelateria dei Neri",
  "Hotel Davanzati",
  "Piazzale Michelangelo",
  "Sostanza",
  "Uffizi",
];

const fixtureDir = join(fileURLToPath(new URL(".", import.meta.url)), "../fixtures/tuscany-slice");
const pagePath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../fixtures/pages/sorbettiera.html",
);

const COMMONS_UFFIZI = {
  query: {
    pages: {
      "12345": {
        title: "File:Uffizi.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/Uffizi.jpg",
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              Artist: { value: "Sailko" },
            },
          },
        ],
      },
    },
  },
};

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as unknown;
}

function florenceOverpass(): unknown {
  const body = loadJson("overpass-florence.json");
  if (typeof body !== "object" || body === null || !("elements" in body)) {
    throw new Error("overpass fixture missing elements");
  }
  const elements = body.elements;
  if (!Array.isArray(elements)) throw new Error("overpass elements are not an array");
  return {
    ...body,
    elements: [
      ...elements,
      {
        type: "node",
        id: 113,
        lat: 43.77005,
        lon: 11.25335,
        tags: {
          name: "Trattoria Sostanza",
          amenity: "restaurant",
          cuisine: "tuscan",
        },
      },
    ],
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  return new URL(input.url);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function nominatimHit(lat: string, lon: string, category: string): unknown[] {
  const latN = Number(lat);
  const lonN = Number(lon);
  return [
    {
      lat,
      lon,
      category,
      type: "administrative",
      display_name: "Florence, Tuscany, Italy",
      boundingbox: [
        String(latN - 0.02),
        String(latN + 0.02),
        String(lonN - 0.02),
        String(lonN + 0.02),
      ],
      geojson: {
        type: "Polygon",
        coordinates: [
          [
            [11.15, 43.72],
            [11.33, 43.72],
            [11.33, 43.83],
            [11.15, 43.83],
            [11.15, 43.72],
          ],
        ],
      },
    },
  ];
}

function fastCfg(): ScoutConfig {
  return {
    ...DEFAULT_SCOUT_CONFIG,
    areasCount: { min: 1, max: 4 },
    overpass: { ...DEFAULT_SCOUT_CONFIG.overpass, minIntervalMs: 0 },
    nominatim: { ...DEFAULT_SCOUT_CONFIG.nominatim, minIntervalMs: 0 },
  };
}

function writeDestination(repoRoot: string, slug: string): void {
  const dir = join(repoRoot, "work", slug);
  mkdirSync(dir, { recursive: true });
  const destination = {
    slug,
    name: "Florence",
    kind: "city",
    bbox: FLORENCE,
    center: { lat: 43.77, lng: 11.25 },
    hints: [],
    polygon: {
      type: "Polygon",
      coordinates: [
        [
          [11.15, 43.72],
          [11.33, 43.72],
          [11.33, 43.83],
          [11.15, 43.83],
          [11.15, 43.72],
        ],
      ],
    },
  };
  writeFileSyncJson(join(dir, "00-destination.json"), destination);
}

function writeFileSyncJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function categoryForName(name: string): PlaceCategory {
  const key = name.toLowerCase();
  if (key.includes("sorbettiera") || key.includes("gelateria")) return "food.dessert";
  if (key.includes("forno") || key.includes("bakery")) return "food.cafe";
  if (key.includes("verrazzano")) return "food.wine";
  if (key.includes("hotel")) return "leisure.relax";
  if (key.includes("michelangelo")) return "nature.viewpoint";
  if (key.includes("boboli")) return "nature.park";
  if (key.includes("uffizi")) return "culture.museum";
  return "food.restaurant";
}

function enriched(id: string, name: string): EnrichedPlace {
  const primaryCategory = categoryForName(name);
  const band = dwellBandFor(primaryCategory);
  const dwellMin = Math.round((band[0] + band[1]) / 2);
  return {
    id,
    primaryCategory,
    secondary: [],
    dwellMin,
    dwellRange: [band[0], band[1]],
    effort: 1,
    indoor: true,
    needsBooking: false,
    queueBufferMin: 0,
    bestTimeOfDay: ["morning"],
    kidFriendly: "yes",
    accessibility: "",
    priceLevel: 2,
    blurb: `${name} is on the Florence scout menu.`,
  };
}

function normalisedQuote(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceId(url: string, quote: string): string {
  return createHash("sha1")
    .update(`${url}|${normalisedQuote(quote)}`)
    .digest("hex");
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

type PlaceFile = {
  id: string;
  name: string;
  normalizedName: string;
  lat: number;
  lng: number;
  status: string;
  aliases: string[];
};

type EvidenceFile = {
  id: string;
  placeId: string;
  url: string;
  quote: string;
  quoteVerified: boolean;
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function isPlace(value: unknown): value is PlaceFile {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.normalizedName === "string" &&
    typeof row.lat === "number" &&
    typeof row.lng === "number" &&
    typeof row.status === "string" &&
    Array.isArray(row.aliases)
  );
}

function fixtureFetch(): typeof fetch {
  const overpass = florenceOverpass();
  const wikidata = loadJson("wikidata-florence.json");
  return async (input, init) => {
    const url = requestUrl(input);
    expect(new Headers(init?.headers).get("user-agent")).toBe(DEFAULT_SCOUT_CONFIG.fetch.userAgent);
    if (url.pathname.endsWith("/interpreter")) return jsonResponse(overpass);
    if (url.href === "https://www.wikidata.org/wiki/Special:EntityData/Q123.json") {
      return jsonResponse(wikidata);
    }
    if (url.origin === "https://commons.wikimedia.org" && url.pathname === "/w/api.php") {
      return jsonResponse(COMMONS_UFFIZI);
    }
    if (url.origin === "https://nominatim.openstreetmap.org" && url.pathname === "/search") {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("Sorbettiera"))
        return jsonResponse(nominatimHit("43.7660", "11.2480", "amenity"));
      if (q.includes("Florence"))
        return jsonResponse(nominatimHit("43.7695608", "11.2558136", "boundary"));
    }
    throw new Error(`unexpected url ${url.href}`);
  };
}

function pageFetch(): (
  url: string,
  opts: { fetchImpl: typeof fetch; cfg: ScoutConfig },
) => Promise<{ text: string; quoteAllowed: boolean } | { skipped: string }> {
  const html = readFileSync(pagePath, "utf8");
  return async (url) => {
    if (url.includes("sorbettiera")) return { text: html, quoteAllowed: true };
    return { skipped: "not-fixture" };
  };
}

test("dry-run writes one place per keeper, verifies the gelateria quote, and keeps place ids", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "scout-e2e-"));
  const slug = "florence";
  writeDestination(repoRoot, slug);
  const overpass = florenceOverpass();
  expect(JSON.stringify(overpass)).toContain("Trattoria Sostanza");
  expect(JSON.stringify(overpass)).toContain("Sostanza");

  let enrichedCount = 0;
  const recorded = createFakeBackend({
    areas: {
      areas: [
        { name: "Florence", lat: 43.77, lng: 11.25, why: "The scouted centre", kind: "town" },
      ],
    },
    trends: {
      findings: [
        {
          placeName: "Gelateria La Sorbettiera",
          category: "food.dessert",
          whyTrending: "A spring sorbet queue on social video.",
          sourceUrl: SOURCE_URL,
          platformMentioned: "tiktok",
          evidenceQuote: QUOTE,
        },
      ],
    },
    enrich: { places: [] },
    stays: {
      zones: [
        {
          name: "Centro Storico",
          rationale: "Museums and trattorie sit inside the old centre.",
          exampleProperties: [{ name: "Hotel Davanzati", priceLevel: 3 }],
        },
      ],
    },
  });
  const backend = {
    ...recorded,
    enrichBatch: async (req: { candidates: { id: string; name: string }[] }) => {
      enrichedCount += req.candidates.length;
      return { places: req.candidates.map((candidate) => enriched(candidate.id, candidate.name)) };
    },
  };

  const opts = {
    repoRoot,
    slug,
    backend,
    cfg: fastCfg(),
    dryRun: true as const,
    now: () => NOW,
    budget: { llm: 20, searches: 2 },
    fetchImpl: fixtureFetch(),
    fetchPage: pageFetch(),
  };
  const first = await runPipeline(opts);
  expect(first.exitCode).toBe(0);

  const places = readJson<unknown[]>(join(first.outDir, "places.json")).filter(isPlace);
  const active = places.filter((place) => place.status === "active");
  expect(active.map((place) => place.name).sort()).toEqual(
    [...HARVEST_KEEPERS, "Gelateria La Sorbettiera"].sort(),
  );
  expect(enrichedCount).toBe(active.length);

  const sostanza = active.filter(
    (place) =>
      normalizeName(place.name) === "sostanza" ||
      place.aliases.some((alias) => normalizeName(alias) === "sostanza"),
  );
  expect(sostanza).toHaveLength(1);

  const decisions = readJson<{ decisions: { name: string; kind: string }[] }>(
    join(repoRoot, "work", slug, "04-resolve.json"),
  );
  const pending = readJson<{ placeIdA: string; placeIdB: string }[]>(
    join(first.outDir, "pending-merges.json"),
  );
  const matched = decisions.decisions.some(
    (row) => normalizeName(row.name) === "sostanza" && row.kind === "match",
  );
  const queued = pending.length > 0;
  expect(matched || queued).toBe(true);

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i];
      const right = active[j];
      if (left === undefined || right === undefined) continue;
      if (left.normalizedName !== right.normalizedName) continue;
      expect(haversineM(left.lat, left.lng, right.lat, right.lng)).toBeGreaterThanOrEqual(150);
    }
  }

  const evidence = readJson<EvidenceFile[]>(join(first.outDir, "evidence.json"));
  const gelato = evidence.filter(
    (row) => row.url === SOURCE_URL || row.quote.includes("Sorbettiera"),
  );
  expect(gelato.length).toBeGreaterThan(0);
  expect(gelato.every((row) => row.quoteVerified)).toBe(true);
  expect(gelato.map((row) => row.id)).toContain(evidenceId(SOURCE_URL, QUOTE));

  expect(readFileSync(join(first.outDir, "pack.json"), "utf8").length).toBeGreaterThan(2);
  expect(readFileSync(join(first.outDir, "stayAreas.json"), "utf8")).toContain("Centro Storico");
  expect(readFileSync(join(first.outDir, "run-report.md"), "utf8")).toContain(
    String(active.length),
  );

  const ids = active.map((place) => place.id).sort();
  const second = await runPipeline(opts);
  expect(second.exitCode).toBe(0);
  const again = readJson<unknown[]>(join(second.outDir, "places.json"))
    .filter(isPlace)
    .filter((place) => place.status === "active")
    .map((place) => place.id)
    .sort();
  expect(again).toEqual(ids);

  for (const file of [
    "pipeline.ts",
    "stages/01-areas.ts",
    "stages/04-resolve.ts",
    "stages/07-writeDry.ts",
  ]) {
    const src = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
    expect(src.toLowerCase()).not.toContain("firestore");
  }
});

test("AwaitingPackets, BudgetExceeded and RejectionsExceeded map to exit 3, 4 and 5", async () => {
  const cases = [
    { error: new AwaitingPackets("areas-1"), exitCode: 3 },
    { error: new BudgetExceeded("llm"), exitCode: 4 },
    {
      error: new RejectionsExceeded("areas-1", [{ path: "areas", reason: "too few areas" }]),
      exitCode: 5,
    },
  ] as const;
  for (const item of cases) {
    const repoRoot = mkdtempSync(join(tmpdir(), "scout-exit-"));
    writeDestination(repoRoot, "florence");
    const backend = {
      id: "fake" as const,
      listAreas: async () => {
        throw item.error;
      },
      extractTrends: async () => {
        throw item.error;
      },
      enrichBatch: async () => {
        throw item.error;
      },
      suggestStays: async () => {
        throw item.error;
      },
    };
    const result = await runPipeline({
      repoRoot,
      slug: "florence",
      backend,
      cfg: fastCfg(),
      dryRun: true,
      now: () => NOW,
      budget: { llm: 20, searches: 2 },
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
    });
    expect(result.exitCode).toBe(item.exitCode);
  }
});
