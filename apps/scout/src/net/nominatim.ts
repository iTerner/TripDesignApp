import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import simplify from "@turf/simplify";
import { type BBox, DEFAULT_SCOUT_CONFIG, type DestinationGeometry } from "@wayfare/domain";
import type { MultiPolygon, Polygon } from "geojson";
import { createLimiter } from "./rateLimit";

export interface GeocodeCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const CACHE_KEY = /^[0-9a-f]{40}$/;

export class FileGeocodeCache implements GeocodeCache {
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<unknown | undefined> {
    try {
      const text = await readFile(this.pathFor(key), "utf8");
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const body = JSON.stringify(value);
    if (body === undefined) {
      throw new Error("refused: cache value is not json");
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(key), body, "utf8");
  }

  private pathFor(key: string): string {
    if (!CACHE_KEY.test(key)) {
      throw new Error("refused: unsafe cache key");
    }
    return join(this.dir, `${key}.json`);
  }
}

export type NominatimKind = "city" | "region" | "country";

export type NominatimSearchHit = DestinationGeometry & {
  polygon?: Polygon | MultiPolygon;
};

export interface NominatimClient {
  search(q: string, kind: NominatimKind): Promise<NominatimSearchHit>;
  reverse(lat: number, lng: number): Promise<{ displayName: string } | undefined>;
}

export function createNominatim(opts: {
  fetchImpl: typeof fetch;
  cache: GeocodeCache;
  userAgent: string;
  minIntervalMs: number;
}): NominatimClient {
  const limiter = createLimiter(opts.minIntervalMs);
  const headers = { "user-agent": opts.userAgent, accept: "application/json" };
  const base = DEFAULT_SCOUT_CONFIG.nominatim.baseUrl;

  return {
    async search(q: string, kind: NominatimKind): Promise<NominatimSearchHit> {
      const key = sha1(`${kind}|${q}`);
      const cached = parseHit(await opts.cache.get(key));
      if (cached !== undefined) {
        return cached;
      }
      await limiter.wait();
      const url = new URL("/search", base);
      url.searchParams.set("q", q);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("polygon_geojson", "1");
      url.searchParams.set("limit", "1");
      const response = await opts.fetchImpl(url, { headers });
      if (!response.ok) {
        throw new Error(`nominatim search failed: ${response.status}`);
      }
      const body: unknown = await response.json();
      const item = firstRecord(body);
      if (item === undefined) {
        throw new Error("nominatim: no result");
      }
      if ((kind === "region" || kind === "country") && item.category !== "boundary") {
        throw new Error("nominatim: expected category boundary");
      }
      const hit = toHit(item, kind);
      await opts.cache.set(key, hit);
      return hit;
    },

    async reverse(lat: number, lng: number): Promise<{ displayName: string } | undefined> {
      const key = sha1(`reverse|${lat}|${lng}`);
      const cached = parseReverse(await opts.cache.get(key));
      if (cached !== undefined) {
        return cached;
      }
      await limiter.wait();
      const url = new URL("/reverse", base);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("format", "jsonv2");
      const response = await opts.fetchImpl(url, { headers });
      if (response.status === 404) {
        return undefined;
      }
      if (!response.ok) {
        throw new Error(`nominatim reverse failed: ${response.status}`);
      }
      const body: unknown = await response.json();
      if (
        !isRecord(body) ||
        typeof body.display_name !== "string" ||
        body.display_name.length === 0
      ) {
        return undefined;
      }
      const hit = { displayName: body.display_name };
      await opts.cache.set(key, hit);
      return hit;
    },
  };
}

function toHit(item: Record<string, unknown>, kind: NominatimKind): NominatimSearchHit {
  const lat = asNumber(item.lat);
  const lng = asNumber(item.lon);
  if (lat === undefined || lng === undefined) {
    throw new Error("nominatim: invalid coordinates");
  }
  const bbox = parseBBox(item.boundingbox);
  const raw = asPolygon(item.geojson);
  const polygon =
    raw === undefined ? undefined : simplifyIfLarge(raw, DEFAULT_SCOUT_CONFIG.polygon);
  return {
    bbox,
    center: { lat, lng },
    ...(kind === "city" ? { radiusKm: DEFAULT_SCOUT_CONFIG.cityRadiusKm } : {}),
    ...(polygon !== undefined ? { polygon } : {}),
  };
}

function simplifyIfLarge(
  geometry: Polygon | MultiPolygon,
  limits: { simplifyAboveBytes: number; simplifyTolerance: number },
): Polygon | MultiPolygon {
  const input = JSON.stringify(geometry);
  if (Buffer.byteLength(input, "utf8") <= limits.simplifyAboveBytes) {
    return geometry;
  }
  const simplified = simplify(geometry, {
    tolerance: limits.simplifyTolerance,
    highQuality: false,
    mutate: false,
  });
  if (simplified.type === "Polygon" || simplified.type === "MultiPolygon") {
    return simplified;
  }
  return geometry;
}

function parseHit(value: unknown): NominatimSearchHit | undefined {
  if (!isRecord(value) || !isRecord(value.center) || !isRecord(value.bbox)) {
    return undefined;
  }
  const lat = value.center.lat;
  const lng = value.center.lng;
  const { south, west, north, east } = value.bbox;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    typeof south !== "number" ||
    typeof west !== "number" ||
    typeof north !== "number" ||
    typeof east !== "number"
  ) {
    return undefined;
  }
  const polygon = value.polygon === undefined ? undefined : asPolygon(value.polygon);
  if (value.polygon !== undefined && polygon === undefined) {
    return undefined;
  }
  const radiusKm = value.radiusKm;
  if (radiusKm !== undefined && typeof radiusKm !== "number") {
    return undefined;
  }
  return {
    bbox: { south, west, north, east },
    center: { lat, lng },
    ...(typeof radiusKm === "number" ? { radiusKm } : {}),
    ...(polygon !== undefined ? { polygon } : {}),
  };
}

function parseReverse(value: unknown): { displayName: string } | undefined {
  if (!isRecord(value) || typeof value.displayName !== "string" || value.displayName.length === 0) {
    return undefined;
  }
  return { displayName: value.displayName };
}

function parseBBox(value: unknown): BBox {
  if (!Array.isArray(value) || value.length < 4) {
    throw new Error("nominatim: invalid bounding box");
  }
  const south = asNumber(value[0]);
  const north = asNumber(value[1]);
  const west = asNumber(value[2]);
  const east = asNumber(value[3]);
  if (south === undefined || north === undefined || west === undefined || east === undefined) {
    throw new Error("nominatim: invalid bounding box");
  }
  return { south, west, north, east };
}

function asPolygon(value: unknown): Polygon | MultiPolygon | undefined {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) {
    return undefined;
  }
  if (value.type === "Polygon" || value.type === "MultiPolygon") {
    return value as unknown as Polygon | MultiPolygon;
  }
  return undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const item = value[0];
  return isRecord(item) ? item : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
