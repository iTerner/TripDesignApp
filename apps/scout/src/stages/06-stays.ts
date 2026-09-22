import {
  type AreaKind,
  type ScoutConfig,
  type StaysRequest,
  type StaysResponse,
  StaysResponseSchema,
  type ValidationResult,
} from "@wayfare/domain";

const STAY_TOURISM = new Set(["hotel", "guest_house", "apartment", "hostel", "chalet"]);
const MAX_ACCOMMODATIONS = 60;
const EARTH_RADIUS_KM = 6371;

export type StayArea = {
  name: string;
  lat: number;
  lng: number;
  kind: AreaKind;
};

export type StayCandidate = {
  name: string;
  lat: number;
  lng: number;
  tourism: string;
  website?: string;
};

export type StaysPacket = {
  packetId: string;
  request: StaysRequest;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toAccommodation(candidate: StayCandidate): StaysRequest["accommodations"][number] {
  const base = {
    name: candidate.name,
    lat: candidate.lat,
    lng: candidate.lng,
    tourism: candidate.tourism,
  };
  if (candidate.website !== undefined) return { ...base, website: candidate.website };
  return base;
}

/** Group stay-tourism candidates to the nearest area centre within `areaRadiusKm`. */
export function staysPackets(
  areas: readonly StayArea[],
  accommodations: readonly StayCandidate[],
  cfg: ScoutConfig,
): StaysPacket[] {
  const buckets = areas.map(
    () => [] as { candidate: StayCandidate; distanceKm: number; order: number }[],
  );

  let order = 0;
  for (const candidate of accommodations) {
    if (!STAY_TOURISM.has(candidate.tourism)) continue;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < areas.length; i++) {
      const area = areas[i];
      if (!area) continue;
      const distanceKm = haversineKm(area.lat, area.lng, candidate.lat, candidate.lng);
      if (distanceKm <= cfg.areaRadiusKm[area.kind] && distanceKm < bestDistance) {
        bestIndex = i;
        bestDistance = distanceKm;
      }
    }
    const bucket = bestIndex >= 0 ? buckets[bestIndex] : undefined;
    if (bucket) {
      bucket.push({ candidate, distanceKm: bestDistance, order });
      order += 1;
    }
  }

  const packets: StaysPacket[] = [];
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const assigned = buckets[i];
    if (!area || !assigned || assigned.length === 0) continue;
    assigned.sort((a, b) => a.distanceKm - b.distanceKm || a.order - b.order);
    packets.push({
      packetId: `stays-${packets.length + 1}`,
      request: {
        area: { name: area.name, lat: area.lat, lng: area.lng, kind: area.kind },
        accommodations: assigned
          .slice(0, MAX_ACCOMMODATIONS)
          .map((row) => toAccommodation(row.candidate)),
        areaFacts: [],
      },
    });
  }
  return packets;
}

export function validateStays(raw: unknown): ValidationResult<StaysResponse> {
  const parsed = StaysResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reasons: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        reason: issue.message,
      })),
    };
  }
  return { ok: true, data: parsed.data };
}
