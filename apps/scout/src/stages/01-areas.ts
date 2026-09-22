import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AreaRecord,
  AreaRecordSchema,
  type AreasRequest,
  type BBox,
  type DestinationKind,
  type ScoutConfig,
  validatePacketResponse,
} from "@wayfare/domain";
import type { MultiPolygon, Polygon } from "geojson";
import type { IntelligenceBackend } from "../backend/types";
import { areaCircleBBox, pointInside } from "../net/geometry";
import type { NominatimClient } from "../net/nominatim";

export interface DestinationFile {
  slug: string;
  name: string;
  kind: DestinationKind;
  bbox: BBox;
  center: { lat: number; lng: number };
  hints: string[];
  polygon?: Polygon | MultiPolygon;
}

const EARTH_RADIUS_M = 6_371_000;

export function readDestination(workRoot: string): DestinationFile {
  const file = join(workRoot, "00-destination.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) throw new Error("refused: unknown destination");
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  const destination = parseDestination(parsed);
  if (destination === undefined) throw new Error("refused: destination file is invalid");
  return destination;
}

/** Model areas, checked against Nominatim and clipped to the destination bbox. */
export async function verifyAreas(opts: {
  destination: DestinationFile;
  backend: IntelligenceBackend;
  nominatim: NominatimClient;
  cfg: ScoutConfig;
}): Promise<AreaRecord[]> {
  const request = areasRequest(opts.destination, opts.cfg);
  const response = await opts.backend.listAreas(request);
  const validated = validatePacketResponse("areas", request, response);
  if (!validated.ok) {
    const detail = validated.reasons.map((reason) => `${reason.path}: ${reason.reason}`).join("; ");
    throw new Error(`invalid areas response: ${detail}`);
  }

  const records: AreaRecord[] = [];
  for (const suggestion of validated.data.areas) {
    const hit = await opts.nominatim.search(suggestion.name, "city").catch(() => undefined);
    if (hit === undefined) continue;
    const driftKm =
      haversineM(suggestion.lat, suggestion.lng, hit.center.lat, hit.center.lng) / 1000;
    if (driftKm > opts.cfg.areaCoordsMaxDriftKm) continue;
    if (
      opts.destination.polygon &&
      !pointInside(hit.center.lat, hit.center.lng, opts.destination.polygon)
    ) {
      continue;
    }
    const circle = areaCircleBBox(hit.center, suggestion.kind, opts.cfg);
    const bbox = clipBBox(circle, opts.destination.bbox);
    if (bbox === undefined) continue;
    records.push(
      AreaRecordSchema.parse({
        name: suggestion.name,
        slug: slugify(suggestion.name),
        lat: hit.center.lat,
        lng: hit.center.lng,
        kind: suggestion.kind,
        why: suggestion.why,
        bbox,
        packetId: "areas-1",
      }),
    );
  }
  return records;
}

function areasRequest(destination: DestinationFile, cfg: ScoutConfig): AreasRequest {
  return {
    destination: { slug: destination.slug, name: destination.name, kind: destination.kind },
    bbox: destination.bbox,
    hints: destination.hints.slice(0, 20),
    minAreas: cfg.areasCount.min,
    maxAreas: cfg.areasCount.max,
  };
}

function clipBBox(inner: BBox, outer: BBox): BBox | undefined {
  const south = Math.max(inner.south, outer.south);
  const north = Math.min(inner.north, outer.north);
  const west = Math.max(inner.west, outer.west);
  const east = Math.min(inner.east, outer.east);
  if (south >= north || west >= east) return undefined;
  return { south, west, north, east };
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`refused: unsafe area "${name}"`);
  }
  return slug;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function parseDestination(value: unknown): DestinationFile | undefined {
  if (!isRecord(value)) return undefined;
  const slug = asString(value.slug);
  const name = asString(value.name);
  const kind = asKind(value.kind);
  const bbox = asBBox(value.bbox);
  const center = asLatLng(value.center);
  if (
    slug === undefined ||
    name === undefined ||
    kind === undefined ||
    bbox === undefined ||
    center === undefined
  ) {
    return undefined;
  }
  const hints = asHints(value.hints);
  const polygon = asPolygon(value.polygon);
  if (value.polygon !== undefined && polygon === undefined) return undefined;
  return {
    slug,
    name,
    kind,
    bbox,
    center,
    hints,
    ...(polygon !== undefined ? { polygon } : {}),
  };
}

function asKind(value: unknown): DestinationKind | undefined {
  if (value === "city" || value === "region" || value === "country") return value;
  return undefined;
}

function asBBox(value: unknown): BBox | undefined {
  if (!isRecord(value)) return undefined;
  const south = asNumber(value.south);
  const west = asNumber(value.west);
  const north = asNumber(value.north);
  const east = asNumber(value.east);
  if (south === undefined || west === undefined || north === undefined || east === undefined)
    return undefined;
  return { south, west, north, east };
}

function asLatLng(value: unknown): { lat: number; lng: number } | undefined {
  if (!isRecord(value)) return undefined;
  const lat = asNumber(value.lat);
  const lng = asNumber(value.lng);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function asHints(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return [];
  return value;
}

function asPolygon(value: unknown): Polygon | MultiPolygon | undefined {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) return undefined;
  if (value.type === "Polygon" || value.type === "MultiPolygon") {
    return value as unknown as Polygon | MultiPolygon;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
