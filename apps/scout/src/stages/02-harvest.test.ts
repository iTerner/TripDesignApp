import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BBox, DEFAULT_SCOUT_CONFIG, type ScoutConfig } from "@wayfare/domain";
import { vi } from "vitest";
import { harvestAreas, keepCandidate, type OsmCandidate, OVERPASS_GROUPS } from "./02-harvest";

const BBOX = "43.72,11.15,43.83,11.33";
const FLORENCE: BBox = { south: 43.72, west: 11.15, north: 43.83, east: 11.33 };
const USER_AGENT = DEFAULT_SCOUT_CONFIG.fetch.userAgent;
const fixtureDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../fixtures/tuscany-slice",
);

const KEEPERS = [
  "Uffizi",
  "Sostanza",
  "Gelateria dei Neri",
  "Piazzale Michelangelo",
  "Forno Ghibellina",
  "Castello di Verrazzano",
  "Hotel Davanzati",
  "Boboli",
];

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

function candidate(name: string, tags: Record<string, string>, osmId = "1"): OsmCandidate {
  return { osmType: "node", osmId, name, lat: 43.77, lng: 11.25, tags };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string" || input instanceof URL) {
    return new URL(input);
  }
  return new URL(input.url);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cfgWith(maxCandidates: number): ScoutConfig {
  return { ...DEFAULT_SCOUT_CONFIG, maxCandidates };
}

function cacheDir(): string {
  return mkdtempSync(join(tmpdir(), "scout-harvest-"));
}

function postedQuery(init: RequestInit | undefined): string {
  const raw = String(init?.body ?? "");
  return raw.startsWith("data=") ? decodeURIComponent(raw.slice("data=".length)) : raw;
}

async function runWithTimers<T>(start: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = start();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

test("drops nameless, disused, abandoned, vacant, and tag-poor places", () => {
  expect(keepCandidate(candidate("", { amenity: "restaurant" }))).toBe(false);
  expect(
    keepCandidate(
      candidate("Sostanza", {
        name: "Sostanza",
        amenity: "restaurant",
        website: "https://sostanza.example",
      }),
    ),
  ).toBe(true);
  expect(
    keepCandidate(
      candidate("Old Cafe", {
        name: "Old Cafe",
        "disused:amenity": "restaurant",
        website: "https://old.example",
      }),
    ),
  ).toBe(false);
  expect(
    keepCandidate(
      candidate("Abandoned Cafe", {
        name: "Abandoned Cafe",
        "abandoned:amenity": "cafe",
        website: "https://abandoned.example",
      }),
    ),
  ).toBe(false);
  expect(
    keepCandidate(
      candidate("Vacant Shop", {
        name: "Vacant Shop",
        shop: "vacant",
        website: "https://vacant.example",
      }),
    ),
  ).toBe(false);
  expect(
    keepCandidate(candidate("Uffizi", { name: "Uffizi", tourism: "museum", wikidata: "Q123" })),
  ).toBe(true);
  expect(
    keepCandidate(candidate("Plain Trattoria", { name: "Plain Trattoria", amenity: "restaurant" })),
  ).toBe(false);
  expect(
    keepCandidate(
      candidate("Piazzale Michelangelo", { name: "Piazzale Michelangelo", tourism: "viewpoint" }),
    ),
  ).toBe(true);
});

test("builds eight Overpass groups and the food query carries the amenity filter and bbox", () => {
  expect(OVERPASS_GROUPS).toHaveLength(8);
  const queries = OVERPASS_GROUPS.map((group) => group.query(BBOX));
  const food = OVERPASS_GROUPS.find((group) => group.id === "food");
  expect(food).toBeDefined();
  const foodQuery = food?.query(BBOX) ?? "";
  expect(foodQuery).toContain(
    'amenity~"restaurant|cafe|ice_cream|bar|pub|marketplace|theatre|arts_centre"',
  );
  expect(foodQuery).toContain(BBOX);

  const once = (snippet: string) => {
    expect(queries.filter((query) => query.includes(snippet))).toHaveLength(1);
  };
  once('tourism~"museum|attraction|viewpoint|gallery|artwork|theme_park|zoo|aquarium"');
  once("[historic]");
  once('amenity~"restaurant|cafe|ice_cream|bar|pub|marketplace|theatre|arts_centre"');
  once('shop~"bakery|pastry|confectionery|wine|deli|cheese|books|antiques|boutique|mall"');
  once('leisure~"park|garden|spa|beach_resort|nature_reserve"');
  once('natural~"beach|peak|spring|cave_entrance"');
  once('craft~"winery|distillery"');
  once('tourism~"hotel|guest_house|apartment|hostel|chalet"');

  for (const query of queries) {
    expect(query.startsWith("[out:json][timeout:60];(")).toBe(true);
    expect(query).toContain(`node[`);
    expect(query).toContain(`way[`);
    expect(query).toContain(`relation[`);
    expect(query.endsWith(");out center;")).toBe(true);
    expect(query).toContain(`(${BBOX});`);
  }
});

test("harvests the Florence fixture, caches raw responses, and enriches the one Wikidata QID", async () => {
  const overpass = loadJson("overpass-florence.json");
  const wikidata = loadJson("wikidata-florence.json");
  expect(Array.isArray((overpass as { elements?: unknown }).elements)).toBe(true);
  expect((overpass as { elements: unknown[] }).elements).toHaveLength(12);

  const dir = cacheDir();
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    urls.push(url.href);
    expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
    if (url.href.startsWith("https://overpass-api.de/api/interpreter")) {
      expect(init?.method).toBe("POST");
      const query = postedQuery(init);
      expect(query).toContain("[out:json][timeout:60]");
      expect(query).toContain("out center;");
      expect(query).toContain(BBOX);
      return jsonResponse(overpass);
    }
    if (url.href === "https://www.wikidata.org/wiki/Special:EntityData/Q123.json") {
      return jsonResponse(wikidata);
    }
    if (url.origin === "https://commons.wikimedia.org" && url.pathname === "/w/api.php") {
      expect(url.searchParams.get("prop")).toBe("imageinfo");
      expect(url.searchParams.get("iiprop")).toBe("url|extmetadata");
      expect(url.searchParams.get("titles")).toBe("File:Uffizi.jpg");
      return jsonResponse(COMMONS_UFFIZI);
    }
    throw new Error(`unexpected url ${url.href}`);
  });

  const opts = {
    fetchImpl,
    cacheDir: dir,
    cfg: cfgWith(DEFAULT_SCOUT_CONFIG.maxCandidates),
  };
  const first = await runWithTimers(() =>
    harvestAreas([{ name: "florence", bbox: FLORENCE }], opts),
  );

  expect(first.kept.map((item) => item.name).sort()).toEqual([...KEEPERS].sort());
  expect(first.deferred).toEqual([]);
  expect(first.kept.map((item) => item.name)).not.toContain("Plain Trattoria");
  expect(first.kept.map((item) => item.name)).not.toContain("Closed Museum");
  expect(first.kept.map((item) => item.name)).not.toContain("Vacant Shop");
  expect(first.kept.some((item) => item.name === "")).toBe(false);

  const gelato = first.kept.find((item) => item.name === "Gelateria dei Neri");
  expect(gelato?.tags.opening_hours).toBe("Tu-Su 11:00-23:30");
  expect(first.kept.find((item) => item.name === "Forno Ghibellina")).toMatchObject({
    osmType: "way",
    osmId: "105",
    lat: 43.7712,
    lng: 11.2621,
  });
  expect(first.kept.find((item) => item.name === "Boboli")).toMatchObject({
    osmType: "relation",
    osmId: "108",
    lat: 43.7626,
    lng: 11.2496,
  });
  expect(first.wikidata.Q123).toEqual({
    qid: "Q123",
    label: "Uffizi",
    description: "Art museum in Florence",
    sitelinks: 20,
    website: "https://www.uffizi.it/",
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/0/0f/Uffizi.jpg",
      licence: "CC BY-SA 4.0",
      author: "Sailko",
    },
  });
  expect(Object.keys(first.wikidata)).toEqual(["Q123"]);
  expect(urls.filter((url) => url.includes("Special:EntityData"))).toEqual([
    "https://www.wikidata.org/wiki/Special:EntityData/Q123.json",
  ]);

  for (const group of OVERPASS_GROUPS) {
    const cached = JSON.parse(
      readFileSync(join(dir, `florence-${group.id}.json`), "utf8"),
    ) as unknown;
    expect(cached).toEqual(overpass);
  }

  const callsAfterFirst = fetchImpl.mock.calls.length;
  expect(callsAfterFirst).toBeGreaterThan(0);
  fetchImpl.mockImplementation(() => Promise.reject(new Error("network should not be called")));
  const second = await runWithTimers(() =>
    harvestAreas([{ name: "florence", bbox: FLORENCE }], opts),
  );
  expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  expect(second.kept.map((item) => item.osmId).sort()).toEqual(
    first.kept.map((item) => item.osmId).sort(),
  );
  expect(second.wikidata).toEqual(first.wikidata);
});

test("caps enrichment at maxCandidates and marks the rest unenriched", async () => {
  const overpass = {
    elements: [
      {
        type: "node",
        id: 1,
        lat: 43.77,
        lon: 11.25,
        tags: { name: "Wiki Place", tourism: "museum", wikidata: "Q555" },
      },
      {
        type: "node",
        id: 2,
        lat: 43.771,
        lon: 11.251,
        tags: { name: "Web Place", amenity: "restaurant", website: "https://web.example" },
      },
      {
        type: "node",
        id: 3,
        lat: 43.772,
        lon: 11.252,
        tags: { name: "Hours Place", amenity: "cafe", opening_hours: "Mo-Su 08:00-18:00" },
      },
      {
        type: "node",
        id: 4,
        lat: 43.773,
        lon: 11.253,
        tags: { name: "Cuisine Place", amenity: "restaurant", cuisine: "tuscan" },
      },
      {
        type: "node",
        id: 5,
        lat: 43.774,
        lon: 11.254,
        tags: { name: "View Place", tourism: "viewpoint" },
      },
    ],
  };
  const wikidata = {
    entities: {
      Q555: {
        id: "Q555",
        labels: { en: { language: "en", value: "Wiki Place" } },
        descriptions: { en: { language: "en", value: "A museum" } },
        claims: {},
        sitelinks: { enwiki: { site: "enwiki", title: "Wiki Place" } },
      },
    },
  };
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    urls.push(url.href);
    if (url.href.startsWith("https://overpass-api.de/api/interpreter")) {
      return jsonResponse(overpass);
    }
    if (url.href === "https://www.wikidata.org/wiki/Special:EntityData/Q555.json") {
      return jsonResponse(wikidata);
    }
    throw new Error(`unexpected url ${url.href}`);
  });

  const result = await runWithTimers(() =>
    harvestAreas([{ name: "florence", bbox: FLORENCE }], {
      fetchImpl,
      cacheDir: cacheDir(),
      cfg: cfgWith(2),
    }),
  );

  expect(result.kept.map((item) => item.name)).toEqual(["Wiki Place", "Web Place"]);
  expect(result.kept.map((item) => item.status)).toEqual([undefined, undefined]);
  expect(result.deferred.map((item) => item.name)).toEqual([
    "Hours Place",
    "Cuisine Place",
    "View Place",
  ]);
  expect(result.deferred.every((item) => item.status === "unenriched")).toBe(true);
  expect(result.wikidata.Q555).toEqual({
    qid: "Q555",
    label: "Wiki Place",
    description: "A museum",
    sitelinks: 1,
  });
  expect(Object.keys(result.wikidata)).toEqual(["Q555"]);
  expect(urls.filter((url) => url.includes("Special:EntityData"))).toEqual([
    "https://www.wikidata.org/wiki/Special:EntityData/Q555.json",
  ]);
});

test("tries the next Overpass endpoint when the first is not HTTP 200", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.href.startsWith("https://overpass-api.de/")) {
      return new Response("busy", { status: 429 });
    }
    if (url.href.startsWith("https://overpass.kumi.systems/")) {
      return jsonResponse({ elements: [] });
    }
    throw new Error(`unexpected url ${url.href}`);
  });
  const opts = {
    fetchImpl,
    cacheDir: cacheDir(),
    cfg: cfgWith(10),
  };
  const first = await runWithTimers(() =>
    harvestAreas([{ name: "florence", bbox: FLORENCE }], opts),
  );
  expect(first.kept).toEqual([]);
  const deCalls = fetchImpl.mock.calls.filter((call) =>
    requestUrl(call[0] as RequestInfo | URL).href.startsWith("https://overpass-api.de/"),
  );
  const kumiCalls = fetchImpl.mock.calls.filter((call) =>
    requestUrl(call[0] as RequestInfo | URL).href.startsWith("https://overpass.kumi.systems/"),
  );
  expect(deCalls).toHaveLength(OVERPASS_GROUPS.length);
  expect(kumiCalls).toHaveLength(OVERPASS_GROUPS.length);

  const callsAfterFirst = fetchImpl.mock.calls.length;
  fetchImpl.mockImplementation(() => Promise.reject(new Error("network should not be called")));
  const second = await runWithTimers(() =>
    harvestAreas([{ name: "florence", bbox: FLORENCE }], opts),
  );
  expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  expect(second.kept).toEqual([]);
});

test("spaces Overpass calls at least minIntervalMs apart", async () => {
  const stamps: number[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.href.startsWith("https://overpass-api.de/api/interpreter")) {
      stamps.push(Date.now());
      return jsonResponse({ elements: [] });
    }
    throw new Error(`unexpected url ${url.href}`);
  });
  await runWithTimers(() =>
    harvestAreas([{ name: "florence", bbox: FLORENCE }], {
      fetchImpl,
      cacheDir: cacheDir(),
      cfg: cfgWith(10),
    }),
  );
  expect(stamps).toHaveLength(OVERPASS_GROUPS.length);
  for (let i = 1; i < stamps.length; i++) {
    const previous = stamps[i - 1];
    const current = stamps[i];
    expect(previous).toBeTypeOf("number");
    expect(current).toBeTypeOf("number");
    expect((current ?? 0) - (previous ?? 0)).toBeGreaterThanOrEqual(
      DEFAULT_SCOUT_CONFIG.overpass.minIntervalMs,
    );
  }
});
