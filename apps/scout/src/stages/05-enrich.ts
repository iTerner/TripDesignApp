import {
  dwellBandFor,
  type EnrichCandidate,
  type EnrichedPlace,
  type EnrichRequest,
  type RejectionReason,
  type ScoutConfig,
  SELECTABLE_CATEGORIES,
  type ValidationResult,
} from "@wayfare/domain";

function packetDwellBands(cfg: ScoutConfig): EnrichRequest["dwellBands"] {
  const bands: EnrichRequest["dwellBands"] = {};
  for (const [key, band] of Object.entries(cfg.dwellBands)) {
    const pair: [number, number] = [band[0], band[1]];
    bands[key] = pair;
  }
  return bands;
}

export function enrichPackets(
  candidates: EnrichCandidate[],
  cfg: ScoutConfig,
): { packetId: string; request: EnrichRequest }[] {
  const packets: { packetId: string; request: EnrichRequest }[] = [];
  const size = cfg.enrichBatchSize;
  for (let offset = 0; offset < candidates.length; offset += size) {
    packets.push({
      packetId: `enrich-${packets.length + 1}`,
      request: {
        candidates: candidates.slice(offset, offset + size),
        taxonomy: [...SELECTABLE_CATEGORIES],
        dwellBands: packetDwellBands(cfg),
      },
    });
  }
  return packets;
}

export function validateEnrichment(
  request: EnrichRequest,
  places: EnrichedPlace[],
  cfg: ScoutConfig,
): ValidationResult<EnrichedPlace[]> {
  const reasons: RejectionReason[] = [];
  const requested = new Set(request.candidates.map((c) => c.id));
  const seen = new Set<string>();
  places.forEach((place, i) => {
    if (!requested.has(place.id)) {
      reasons.push({ path: `places.${i}.id`, reason: "unknown id" });
    } else if (seen.has(place.id)) {
      reasons.push({ path: `places.${i}.id`, reason: "duplicate id" });
    }
    seen.add(place.id);
    const band = dwellBandFor(place.primaryCategory, cfg.dwellBands);
    if (place.dwellMin < band[0] || place.dwellMin > band[1]) {
      reasons.push({
        path: `places.${i}.dwellMin`,
        reason: `dwell implausible for category (${place.primaryCategory} expects ${band[0]}–${band[1]})`,
      });
    }
  });
  for (const id of requested) {
    if (!seen.has(id)) reasons.push({ path: "places", reason: `missing id ${id}` });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, data: places };
}
