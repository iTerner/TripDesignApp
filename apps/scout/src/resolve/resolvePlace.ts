import { categoryGroup, type PlaceCategory, type ScoutConfig } from "@wayfare/domain";
import { jaroWinkler } from "./jaro";
import { normalizeName } from "./normalize";
import { placeIdFor } from "./placeId";

const EARTH_RADIUS_M = 6_371_000;

export type ResolveCandidate = {
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  osmId?: string;
  wikidataId?: string;
  website?: string;
};

export type IndexedPlace = {
  placeId: string;
  normalizedName: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  osmId?: string;
  wikidataId?: string;
  website?: string;
};

export type ResolveIndex = readonly IndexedPlace[];

export type ResolveHit =
  | { kind: "match"; rung: 1 | 2 | 3 | 4; placeId: string }
  | { kind: "new"; placeId: string }
  | { kind: "ambiguous"; candidates: string[]; score: number };

type Scored = {
  place: IndexedPlace;
  distanceM: number;
  jw: number;
  sameGroup: boolean;
};

/**
 * Spec §4 ladder. A hit returns the stored placeId. Rung 3 requires the same
 * category group, so the same name 50 m apart in different groups is ambiguous.
 */
export function resolvePlace(
  candidate: ResolveCandidate,
  index: ResolveIndex,
  cfg: ScoutConfig,
): ResolveHit {
  const normalizedName = normalizeName(candidate.name);
  const scored = index.map((place) => ({
    place,
    distanceM: haversineM(candidate.lat, candidate.lng, place.lat, place.lng),
    jw: jaroWinkler(normalizedName, place.normalizedName),
    sameGroup: categoryGroup(candidate.category) === categoryGroup(place.category),
  }));

  const freshId = placeIdFor(normalizedName, candidate.lat, candidate.lng);
  const decided =
    decide(
      1,
      scored.filter((row) => row.place.placeId === freshId),
    ) ??
    decide(
      2,
      scored.filter((row) => sharesExternalId(candidate, row.place)),
    ) ??
    decide(
      3,
      scored.filter(
        (row) =>
          normalizedName.length > 0 &&
          row.place.normalizedName === normalizedName &&
          row.distanceM < cfg.matchDistanceM.sameName &&
          row.sameGroup,
      ),
    ) ??
    decide(
      4,
      scored.filter(
        (row) =>
          row.jw >= cfg.jaroWinkler.match &&
          row.distanceM < cfg.matchDistanceM.fuzzy &&
          row.sameGroup,
      ),
    );
  if (decided) return decided;

  const fuzzy = scored.filter(
    (row) => row.jw >= cfg.jaroWinkler.ambiguous && row.distanceM < cfg.matchDistanceM.fuzzy,
  );
  if (fuzzy.length > 0) return ambiguousHit(fuzzy);
  return { kind: "new", placeId: freshId };
}

function decide(rung: 1 | 2 | 3 | 4, hits: readonly Scored[]): ResolveHit | undefined {
  const first = hits[0];
  if (hits.length === 1 && first !== undefined) {
    return { kind: "match", rung, placeId: first.place.placeId };
  }
  if (hits.length > 1) return ambiguousHit(hits);
  return undefined;
}

function ambiguousHit(rows: readonly Scored[]): ResolveHit {
  let score = 0;
  const candidates: string[] = [];
  for (const row of rows) {
    candidates.push(row.place.placeId);
    if (row.jw > score) score = row.jw;
  }
  return { kind: "ambiguous", candidates, score };
}

function sharesExternalId(candidate: ResolveCandidate, place: IndexedPlace): boolean {
  if (present(candidate.osmId) && candidate.osmId === place.osmId) return true;
  if (present(candidate.wikidataId) && candidate.wikidataId === place.wikidataId) return true;
  if (candidate.website === undefined || place.website === undefined) return false;
  const left = websiteDomain(candidate.website);
  const right = websiteDomain(place.website);
  return left.length > 0 && left === right;
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

/** Strip protocol and a leading www. Host only, no port or path. */
function websiteDomain(website: string): string {
  let host = website.trim().toLowerCase();
  const scheme = host.indexOf("://");
  if (scheme >= 0) host = host.slice(scheme + 3);
  if (host.startsWith("www.")) host = host.slice(4);
  const cut = host.search(/[/?#]/);
  if (cut >= 0) host = host.slice(0, cut);
  const port = host.lastIndexOf(":");
  if (port >= 0) host = host.slice(0, port);
  return host;
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
