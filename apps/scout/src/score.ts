import type { Platform, ScoutConfig } from "@wayfare/domain";

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function fieldPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/** Fraction of {hours, website, wikidata, image, cuisine-or-description} present (spec §8.8). */
export function completenessOf(place: {
  openingHours?: string;
  website?: string;
  wikidataId?: string;
  image?: unknown;
  description?: string;
}): number {
  const fields = [
    place.openingHours,
    place.website,
    place.wikidataId,
    place.image,
    place.description,
  ];
  return fields.filter(fieldPresent).length / fields.length;
}

/** clamp(0, 100, sitelinksCoef·log10(1+sitelinks) + sourcesCoef·min(sources, cap) + completenessCoef·completeness). */
export function fameScore(
  input: { sitelinks: number; sourcesCount: number; completeness: number },
  cfg: ScoutConfig,
): number {
  const { sitelinksCoef, sourcesCoef, sourcesCap, completenessCoef } = cfg.fame;
  return clampScore(
    sitelinksCoef * Math.log10(1 + input.sitelinks) +
      sourcesCoef * Math.min(input.sourcesCount, sourcesCap) +
      completenessCoef * input.completeness,
  );
}

/**
 * clamp(0, 100, Σ verified evidence of platformWeight · recency · trendScale).
 * recency = max(0, 1 − monthsOld/recencyMonths); a missing date uses unknownDateRecency.
 * Unverified quotes contribute 0.
 */
export function trendScore(
  evidence: { platform: Platform; monthsOld: number | null; quoteVerified: boolean }[],
  cfg: ScoutConfig,
): number {
  let sum = 0;
  for (const item of evidence) {
    if (!item.quoteVerified) continue;
    const weight = cfg.platformWeights[item.platform];
    const recency =
      item.monthsOld === null
        ? cfg.unknownDateRecency
        : Math.max(0, 1 - item.monthsOld / cfg.recencyMonths);
    sum += weight * recency * cfg.trendScale;
  }
  return clampScore(sum);
}
