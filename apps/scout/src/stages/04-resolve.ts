import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type BBox,
  type PendingMerge,
  type Place,
  type PlaceCategory,
  PlaceSchema,
  type ScoutConfig,
  type SourceRef,
} from "@wayfare/domain";
import type { MultiPolygon, Polygon } from "geojson";
import { pointInside } from "../net/geometry";
import type { NominatimClient } from "../net/nominatim";
import { normalizeName } from "../resolve/normalize";
import { type IndexedPlace, type ResolveCandidate, resolvePlace } from "../resolve/resolvePlace";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export interface ResolveInput {
  name: string;
  lat?: number;
  lng?: number;
  category: PlaceCategory;
  areaName: string;
  tags: Record<string, string>;
  osmId?: string;
  wikidataId?: string;
  website?: string;
  wikidataDesc?: string;
  image?: { url: string; licence: string; author: string };
  sitelinks?: number;
  openingHours?: string;
  cuisine?: string;
  packetIds: string[];
  sources: SourceRef[];
  status?: "active" | "unenriched";
  /** Trend findings carry this so evidence follows a merge. */
  findingKey?: string;
}

export interface ResolveDecision {
  name: string;
  kind: "match" | "new" | "ambiguous" | "dropped";
  placeId?: string;
  rung?: 1 | 2 | 3 | 4;
  reason?: string;
}

export interface ResolvedDraft {
  placeId: string;
  name: string;
  aliases: string[];
  normalizedName: string;
  lat: number;
  lng: number;
  geohash7: string;
  category: PlaceCategory;
  areaName: string;
  tags: Record<string, string>;
  osmId?: string;
  wikidataId?: string;
  website?: string;
  wikidataDesc?: string;
  image?: { url: string; licence: string; author: string };
  sitelinks?: number;
  openingHours?: string;
  cuisine?: string;
  packetIds: string[];
  sources: SourceRef[];
  status: Place["status"];
  adminOverrides: Place["adminOverrides"];
  firstSeenAt: string;
  lastSeenRunId: string;
  timesFlagged: number;
  geocoded: boolean;
  seen: boolean;
  findingKeys: string[];
}

export interface ResolveResult {
  drafts: ResolvedDraft[];
  decisions: ResolveDecision[];
  pendingMerges: PendingMerge[];
}

export function categoryForTags(tags: Record<string, string>): PlaceCategory {
  const amenity = tags.amenity;
  const tourism = tags.tourism;
  const shop = tags.shop;
  const leisure = tags.leisure;
  const craft = tags.craft;
  if (amenity === "ice_cream" || shop === "pastry" || shop === "confectionery")
    return "food.dessert";
  if (amenity === "cafe" || shop === "bakery") return "food.cafe";
  if (amenity === "restaurant") return "food.restaurant";
  if (amenity === "bar" || amenity === "pub") return "nightlife.bar";
  if (amenity === "marketplace" || shop === "deli" || shop === "cheese") return "food.market";
  if (shop === "wine" || craft === "winery" || craft === "distillery") return "food.wine";
  if (tourism === "museum") return "culture.museum";
  if (tourism === "gallery") return "culture.gallery";
  if (tourism === "viewpoint") return "nature.viewpoint";
  if (
    tourism === "hotel" ||
    tourism === "guest_house" ||
    tourism === "hostel" ||
    tourism === "apartment" ||
    tourism === "chalet"
  ) {
    return "leisure.relax";
  }
  if (leisure === "park" || leisure === "garden" || leisure === "nature_reserve")
    return "nature.park";
  if (tags.historic !== undefined) return "history.landmark";
  return "experience.local_life";
}

export type LocateHit =
  | { ok: true; input: ResolveInput }
  | { ok: false; reason: "ungeocoded" | "outside_region" };

/** Geocode only when lat/lng are missing. Harvest coordinates are kept. */
export async function locateInput(
  input: ResolveInput,
  nominatim: NominatimClient,
  region: { bbox: BBox; polygon?: Polygon | MultiPolygon },
): Promise<LocateHit> {
  let lat = input.lat;
  let lng = input.lng;
  if (lat === undefined || lng === undefined) {
    try {
      const hit = await nominatim.search(`${input.name}, ${input.areaName}`, "city");
      lat = hit.center.lat;
      lng = hit.center.lng;
    } catch {
      return { ok: false, reason: "ungeocoded" };
    }
  }
  if (!insideBBox(lat, lng, region.bbox)) return { ok: false, reason: "outside_region" };
  if (region.polygon && !pointInside(lat, lng, region.polygon)) {
    return { ok: false, reason: "outside_region" };
  }
  return { ok: true, input: { ...input, lat, lng } };
}

export function resolveDrafts(
  inputs: readonly ResolveInput[],
  existing: readonly Place[],
  cfg: ScoutConfig,
  destSlug: string,
  nowIso: string,
): ResolveResult {
  const byId = new Map<string, ResolvedDraft>();
  for (const place of existing) byId.set(place.id, draftFromPlace(place));
  const index: IndexedPlace[] = [...byId.values()].map(toIndexed);
  const decisions: ResolveDecision[] = [];
  const pendingMerges: PendingMerge[] = [];

  for (const input of inputs) {
    if (input.lat === undefined || input.lng === undefined) {
      decisions.push({ name: input.name, kind: "dropped", reason: "ungeocoded" });
      continue;
    }
    const hit = resolvePlace(toCandidate(input), index, cfg);
    if (hit.kind === "ambiguous") {
      decisions.push({ name: input.name, kind: "ambiguous" });
      const pending = pendingFromAmbiguous(destSlug, hit.candidates, hit.score);
      if (pending !== undefined) pendingMerges.push(pending);
      continue;
    }
    if (hit.kind === "match") {
      const draft = byId.get(hit.placeId);
      if (draft === undefined) {
        decisions.push({ name: input.name, kind: "dropped", reason: "missing match" });
        continue;
      }
      mergeInto(draft, input);
      syncIndex(index, draft);
      decisions.push({ name: input.name, kind: "match", rung: hit.rung, placeId: hit.placeId });
      continue;
    }
    const draft = draftFromInput(input, hit.placeId, nowIso);
    byId.set(draft.placeId, draft);
    index.push(toIndexed(draft));
    decisions.push({ name: input.name, kind: "new", placeId: hit.placeId });
  }

  return { drafts: [...byId.values()], decisions, pendingMerges };
}

/** Pairwise sweep used by `--dedupe`. */
export function dedupePlaces(
  places: readonly Place[],
  cfg: ScoutConfig,
  destSlug: string,
): PendingMerge[] {
  const merges: PendingMerge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < places.length; i += 1) {
    for (let j = i + 1; j < places.length; j += 1) {
      const left = places[i];
      const right = places[j];
      if (left === undefined || right === undefined) continue;
      const hit = resolvePlace(candidateFromPlace(left), [indexedFromPlace(right)], cfg);
      if (hit.kind === "new") continue;
      if (hit.kind === "match" && (hit.rung === 1 || hit.placeId === left.id)) continue;
      const score =
        hit.kind === "ambiguous" ? hit.score : hit.rung <= 3 ? 1 : cfg.jaroWinkler.match;
      const reasons =
        hit.kind === "ambiguous" ? [`ambiguous jw ${hit.score}`] : [`match rung ${hit.rung}`];
      const merge = makeMerge(destSlug, left.id, right.id, score, reasons);
      if (seen.has(merge.id)) continue;
      seen.add(merge.id);
      merges.push(merge);
    }
  }
  return merges;
}

export function readPlacesFile(file: string): Place[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return PlaceSchema.array().parse(parsed);
}

function draftFromInput(input: ResolveInput, placeId: string, nowIso: string): ResolvedDraft {
  if (input.lat === undefined || input.lng === undefined) {
    throw new Error(`refused: ${input.name} has no coordinates`);
  }
  return {
    placeId,
    name: input.name,
    aliases: [],
    normalizedName: normalizeName(input.name),
    lat: input.lat,
    lng: input.lng,
    geohash7: geohash7(input.lat, input.lng),
    category: input.category,
    areaName: input.areaName,
    tags: input.tags,
    ...optionalFields(input),
    packetIds: [...input.packetIds],
    sources: [...input.sources],
    status: input.status ?? "active",
    adminOverrides: {},
    firstSeenAt: nowIso,
    lastSeenRunId: "",
    timesFlagged: 0,
    geocoded: true,
    seen: true,
    findingKeys: input.findingKey !== undefined ? [input.findingKey] : [],
  };
}

function draftFromPlace(place: Place): ResolvedDraft {
  return {
    placeId: place.id,
    name: place.name,
    aliases: [...place.aliases],
    normalizedName: place.normalizedName,
    lat: place.lat,
    lng: place.lng,
    geohash7: place.geohash7,
    category: place.primaryCategory ?? "experience.local_life",
    areaName: place.areaName,
    tags: {},
    ...(place.externalIds.osm !== undefined ? { osmId: place.externalIds.osm } : {}),
    ...(place.wikidataId !== undefined ? { wikidataId: place.wikidataId } : {}),
    ...(place.website !== undefined ? { website: place.website } : {}),
    ...(place.wikidataDescription !== undefined ? { wikidataDesc: place.wikidataDescription } : {}),
    ...(place.image !== undefined ? { image: place.image } : {}),
    ...(place.sitelinks !== undefined ? { sitelinks: place.sitelinks } : {}),
    ...(place.openingHours !== undefined ? { openingHours: place.openingHours } : {}),
    ...(place.cuisine !== undefined ? { cuisine: place.cuisine } : {}),
    packetIds: [...place.packetIds],
    sources: [...place.sources],
    status: place.status,
    adminOverrides: place.adminOverrides,
    firstSeenAt: place.firstSeenAt,
    lastSeenRunId: place.lastSeenRunId,
    timesFlagged: place.timesFlagged,
    geocoded: place.verification.geocoded,
    seen: false,
    findingKeys: [],
  };
}

function mergeInto(draft: ResolvedDraft, input: ResolveInput): void {
  draft.seen = true;
  const canonical = input.name === draft.name;
  if (canonical && input.lat !== undefined && input.lng !== undefined) {
    draft.lat = input.lat;
    draft.lng = input.lng;
    draft.geohash7 = geohash7(input.lat, input.lng);
    draft.areaName = input.areaName;
    draft.tags = input.tags;
    draft.category = input.category;
  }
  if (input.name !== draft.name && !draft.aliases.includes(input.name))
    draft.aliases.push(input.name);
  draft.sources = unionSources(draft.sources, input.sources);
  draft.packetIds = unique([...draft.packetIds, ...input.packetIds]);
  fillMissing(draft, input, canonical);
  if (input.findingKey !== undefined && !draft.findingKeys.includes(input.findingKey)) {
    draft.findingKeys.push(input.findingKey);
  }
  if (input.status === "unenriched" && draft.status === "active") return;
  if (input.status === "unenriched") draft.status = "unenriched";
}

function fillMissing(draft: ResolvedDraft, input: ResolveInput, canonical: boolean): void {
  assign(draft, "osmId", prefer(draft.osmId, input.osmId, canonical));
  assign(draft, "wikidataId", prefer(draft.wikidataId, input.wikidataId, canonical));
  assign(draft, "website", prefer(draft.website, input.website, canonical));
  assign(draft, "wikidataDesc", prefer(draft.wikidataDesc, input.wikidataDesc, canonical));
  assign(draft, "openingHours", prefer(draft.openingHours, input.openingHours, canonical));
  assign(draft, "cuisine", prefer(draft.cuisine, input.cuisine, canonical));
  if (input.image !== undefined && (canonical || draft.image === undefined))
    draft.image = input.image;
  if (input.sitelinks !== undefined && (canonical || draft.sitelinks === undefined)) {
    draft.sitelinks = input.sitelinks;
  }
}

function assign(
  draft: ResolvedDraft,
  key: "osmId" | "wikidataId" | "website" | "wikidataDesc" | "openingHours" | "cuisine",
  value: string | undefined,
): void {
  if (value !== undefined) draft[key] = value;
}

function prefer(
  current: string | undefined,
  incoming: string | undefined,
  canonical: boolean,
): string | undefined {
  if (canonical && incoming !== undefined) return incoming;
  return current ?? incoming;
}

function optionalFields(
  input: ResolveInput,
): Pick<
  ResolvedDraft,
  | "osmId"
  | "wikidataId"
  | "website"
  | "wikidataDesc"
  | "image"
  | "sitelinks"
  | "openingHours"
  | "cuisine"
> {
  return {
    ...(input.osmId !== undefined ? { osmId: input.osmId } : {}),
    ...(input.wikidataId !== undefined ? { wikidataId: input.wikidataId } : {}),
    ...(input.website !== undefined ? { website: input.website } : {}),
    ...(input.wikidataDesc !== undefined ? { wikidataDesc: input.wikidataDesc } : {}),
    ...(input.image !== undefined ? { image: input.image } : {}),
    ...(input.sitelinks !== undefined ? { sitelinks: input.sitelinks } : {}),
    ...(input.openingHours !== undefined ? { openingHours: input.openingHours } : {}),
    ...(input.cuisine !== undefined ? { cuisine: input.cuisine } : {}),
  };
}

function toCandidate(input: ResolveInput): ResolveCandidate {
  if (input.lat === undefined || input.lng === undefined) {
    throw new Error(`refused: ${input.name} has no coordinates`);
  }
  return {
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    category: input.category,
    ...(input.osmId !== undefined ? { osmId: input.osmId } : {}),
    ...(input.wikidataId !== undefined ? { wikidataId: input.wikidataId } : {}),
    ...(input.website !== undefined ? { website: input.website } : {}),
  };
}

function toIndexed(draft: ResolvedDraft): IndexedPlace {
  return {
    placeId: draft.placeId,
    normalizedName: draft.normalizedName,
    lat: draft.lat,
    lng: draft.lng,
    category: draft.category,
    ...(draft.osmId !== undefined ? { osmId: draft.osmId } : {}),
    ...(draft.wikidataId !== undefined ? { wikidataId: draft.wikidataId } : {}),
    ...(draft.website !== undefined ? { website: draft.website } : {}),
  };
}

function candidateFromPlace(place: Place): ResolveCandidate {
  return {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.primaryCategory ?? "experience.local_life",
    ...(place.externalIds.osm !== undefined ? { osmId: place.externalIds.osm } : {}),
    ...(place.wikidataId !== undefined ? { wikidataId: place.wikidataId } : {}),
    ...(place.website !== undefined ? { website: place.website } : {}),
  };
}

function indexedFromPlace(place: Place): IndexedPlace {
  return {
    placeId: place.id,
    normalizedName: place.normalizedName,
    lat: place.lat,
    lng: place.lng,
    category: place.primaryCategory ?? "experience.local_life",
    ...(place.externalIds.osm !== undefined ? { osmId: place.externalIds.osm } : {}),
    ...(place.wikidataId !== undefined ? { wikidataId: place.wikidataId } : {}),
    ...(place.website !== undefined ? { website: place.website } : {}),
  };
}

function syncIndex(index: IndexedPlace[], draft: ResolvedDraft): void {
  const row = index.find((item) => item.placeId === draft.placeId);
  if (row === undefined) return;
  row.lat = draft.lat;
  row.lng = draft.lng;
  row.normalizedName = draft.normalizedName;
  row.category = draft.category;
  if (draft.osmId !== undefined) row.osmId = draft.osmId;
  if (draft.wikidataId !== undefined) row.wikidataId = draft.wikidataId;
  if (draft.website !== undefined) row.website = draft.website;
}

function pendingFromAmbiguous(
  destSlug: string,
  candidates: readonly string[],
  score: number,
): PendingMerge | undefined {
  const left = candidates[0];
  const right = candidates[1] ?? candidates[0];
  if (left === undefined || right === undefined || left === right) return undefined;
  return makeMerge(destSlug, left, right, score, [`ambiguous jw ${score}`]);
}

function makeMerge(
  destSlug: string,
  placeIdA: string,
  placeIdB: string,
  score: number,
  reasons: string[],
): PendingMerge {
  const [left, right] = placeIdA < placeIdB ? [placeIdA, placeIdB] : [placeIdB, placeIdA];
  return {
    id: createHash("sha1").update(`${destSlug}|${left}|${right}`).digest("hex").slice(0, 20),
    destSlug,
    placeIdA: left,
    placeIdB: right,
    score: Math.min(1, Math.max(0, score)),
    reasons,
    status: "open",
  };
}

function unionSources(current: SourceRef[], incoming: readonly SourceRef[]): SourceRef[] {
  const out = [...current];
  for (const source of incoming) {
    if (!out.some((item) => item.kind === source.kind && item.ref === source.ref)) out.push(source);
  }
  return out;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function insideBBox(lat: number, lng: number, bbox: BBox): boolean {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
}

/** Precision-7 geohash. Same midpoint rule as `placeId`. */
function geohash7(lat: number, lng: number): string {
  const chars: string[] = [];
  let bits = 0;
  let bitsTotal = 0;
  let hash = 0;
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  while (chars.length < 7) {
    if (bitsTotal % 2 === 0) {
      const mid = (maxLng + minLng) / 2;
      if (lng > mid) {
        hash = hash * 2 + 1;
        minLng = mid;
      } else {
        hash *= 2;
        maxLng = mid;
      }
    } else {
      const mid = (maxLat + minLat) / 2;
      if (lat > mid) {
        hash = hash * 2 + 1;
        minLat = mid;
      } else {
        hash *= 2;
        maxLat = mid;
      }
    }
    bits += 1;
    bitsTotal += 1;
    if (bits === 5) {
      chars.push(BASE32.charAt(hash));
      bits = 0;
      hash = 0;
    }
  }
  return chars.join("");
}
