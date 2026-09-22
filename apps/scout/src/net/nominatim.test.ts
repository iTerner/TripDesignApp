import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCOUT_CONFIG } from "@wayfare/domain";
import { vi } from "vitest";
import { createNominatim, FileGeocodeCache, type GeocodeCache } from "./nominatim";

const USER_AGENT = DEFAULT_SCOUT_CONFIG.fetch.userAgent;

const florencePolygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [11.15, 43.72],
      [11.33, 43.72],
      [11.33, 43.83],
      [11.15, 43.83],
      [11.15, 43.72],
    ],
  ],
};

class MemoryCache implements GeocodeCache {
  private readonly values = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function florenceResult(category: string) {
  return {
    lat: "43.7695608",
    lon: "11.2558136",
    category,
    type: "administrative",
    display_name: "Florence, Tuscany, Italy",
    boundingbox: ["43.72779", "43.83258", "11.15422", "11.3284"],
    geojson: florencePolygon,
  };
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

test("search returns Florence, caches it, and sends the identifying User-Agent", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("q")).toBe("Florence");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("polygon_geojson")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
    return jsonResponse([florenceResult("boundary")]);
  });
  const client = createNominatim({
    fetchImpl,
    cache: new MemoryCache(),
    userAgent: USER_AGENT,
    minIntervalMs: 1_000,
  });

  const first = await client.search("Florence", "city");
  expect(first.polygon).toEqual(florencePolygon);
  expect(first.center.lat).toBeCloseTo(43.7695608, 5);
  expect(first.center.lng).toBeCloseTo(11.2558136, 5);
  expect(first.bbox.south).toBeCloseTo(43.72779, 5);
  expect(first.bbox.north).toBeCloseTo(43.83258, 5);
  expect(first.bbox.west).toBeCloseTo(11.15422, 5);
  expect(first.bbox.east).toBeCloseTo(11.3284, 4);
  expect(first.radiusKm).toBe(12);

  const second = await client.search("Florence", "city");
  expect(second).toEqual(first);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("region and country searches keep only boundary results", async () => {
  const fetchImpl = vi.fn(async () => jsonResponse([florenceResult("place")]));
  const opts = {
    fetchImpl,
    userAgent: USER_AGENT,
    minIntervalMs: 1_000,
  };
  const region = createNominatim({ ...opts, cache: new MemoryCache() });
  const country = createNominatim({ ...opts, cache: new MemoryCache() });
  await expect(region.search("Florence", "region")).rejects.toThrow(/boundary/);
  await expect(country.search("Italy", "country")).rejects.toThrow(/boundary/);
});

test("two searches honour the one-request-per-interval limiter", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const fetchImpl = vi.fn(async () => jsonResponse([florenceResult("boundary")]));
    const client = createNominatim({
      fetchImpl,
      cache: new MemoryCache(),
      userAgent: USER_AGENT,
      minIntervalMs: 1_000,
    });

    await client.search("Florence", "region");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    let resolved = false;
    const pending = client.search("Siena", "region").then((hit) => {
      resolved = true;
      return hit;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const hit = await pending;
    expect(resolved).toBe(true);
    expect(hit.polygon?.type).toBe("Polygon");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("polygons over the byte threshold are simplified", async () => {
  const steps = 4_000;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) ring.push([11 + (0.2 * i) / steps, 43]);
  for (let i = 0; i <= steps; i += 1) ring.push([11.2, 43 + (0.2 * i) / steps]);
  for (let i = 0; i <= steps; i += 1) ring.push([11.2 - (0.2 * i) / steps, 43.2]);
  for (let i = 0; i <= steps; i += 1) ring.push([11, 43.2 - (0.2 * i) / steps]);
  const polygon = { type: "Polygon" as const, coordinates: [ring] };
  const inputBytes = Buffer.byteLength(JSON.stringify(polygon), "utf8");
  expect(inputBytes).toBeGreaterThan(DEFAULT_SCOUT_CONFIG.polygon.simplifyAboveBytes);

  const fetchImpl = vi.fn(async () =>
    jsonResponse([
      {
        lat: "43.1",
        lon: "11.1",
        category: "boundary",
        boundingbox: ["43", "43.2", "11", "11.2"],
        geojson: polygon,
      },
    ]),
  );
  const client = createNominatim({
    fetchImpl,
    cache: new MemoryCache(),
    userAgent: USER_AGENT,
    minIntervalMs: 1_000,
  });
  const hit = await client.search("Tuscany", "region");
  expect(hit.radiusKm).toBeUndefined();
  const outputBytes = Buffer.byteLength(JSON.stringify(hit.polygon), "utf8");
  expect(outputBytes).toBeLessThan(DEFAULT_SCOUT_CONFIG.polygon.simplifyAboveBytes);
  expect(hit.polygon?.type).toBe("Polygon");
});

test("reverse returns a display name and then uses the cache", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("lat")).toBe("43.77");
    expect(url.searchParams.get("lon")).toBe("11.25");
    expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
    return jsonResponse({ display_name: "Florence, Tuscany, Italy" });
  });
  const client = createNominatim({
    fetchImpl,
    cache: new MemoryCache(),
    userAgent: USER_AGENT,
    minIntervalMs: 1_000,
  });
  await expect(client.reverse(43.77, 11.25)).resolves.toEqual({
    displayName: "Florence, Tuscany, Italy",
  });
  await expect(client.reverse(43.77, 11.25)).resolves.toEqual({
    displayName: "Florence, Tuscany, Italy",
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("reverse returns undefined when Nominatim cannot geocode", async () => {
  const fetchImpl = vi.fn(async () => jsonResponse({ error: "Unable to geocode" }));
  const client = createNominatim({
    fetchImpl,
    cache: new MemoryCache(),
    userAgent: USER_AGENT,
    minIntervalMs: 1_000,
  });
  await expect(client.reverse(0, 0)).resolves.toBeUndefined();
});

test("file geocode cache round-trips json and misses unknown keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geocode-"));
  const cache = new FileGeocodeCache(dir);
  const key = "ab".repeat(20);
  expect(await cache.get(key)).toBeUndefined();
  await cache.set(key, { displayName: "Florence" });
  await expect(cache.get(key)).resolves.toEqual({ displayName: "Florence" });
  await expect(cache.get("a".repeat(40))).resolves.toBeUndefined();
});
