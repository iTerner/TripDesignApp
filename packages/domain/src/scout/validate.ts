import type { ZodError } from "zod";
import { type PlaceCategory, SELECTABLE_CATEGORIES } from "../taxonomy/categories";
import {
  type AreasRequest,
  type AreasResponse,
  type EnrichRequest,
  type EnrichResponse,
  PACKET_SCHEMAS,
  type PacketType,
  type RejectionReason,
  type StaysRequest,
  type StaysResponse,
  type TrendsRequest,
  type TrendsResponse,
} from "./packets";

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; reasons: RejectionReason[] };

const SELECTABLE = new Set<string>(SELECTABLE_CATEGORIES);

function zodReasons(err: ZodError): RejectionReason[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join("."), reason: i.message }));
}

function insideBBox(b: AreasRequest["bbox"], lat: number, lng: number): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

const key = (s: string) => s.trim().toLowerCase();

function semanticAreas(req: AreasRequest, res: AreasResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (res.areas.length < req.minAreas) {
    reasons.push({
      path: "areas",
      reason: `too few areas (got ${res.areas.length}, need ≥ ${req.minAreas})`,
    });
  }
  if (res.areas.length > req.maxAreas) {
    reasons.push({
      path: "areas",
      reason: `too many areas (got ${res.areas.length}, max ${req.maxAreas})`,
    });
  }
  const seen = new Set<string>();
  res.areas.forEach((a, i) => {
    if (!insideBBox(req.bbox, a.lat, a.lng))
      reasons.push({ path: `areas.${i}`, reason: "coords outside bbox" });
    if (seen.has(key(a.name)))
      reasons.push({ path: `areas.${i}.name`, reason: `duplicate area "${a.name}"` });
    seen.add(key(a.name));
  });
  return reasons;
}

function semanticTrends(req: TrendsRequest, res: TrendsResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  if (res.findings.length > req.maxFindings) {
    reasons.push({
      path: "findings",
      reason: `too many findings (got ${res.findings.length}, max ${req.maxFindings})`,
    });
  }
  const seen = new Set<string>();
  res.findings.forEach((f, i) => {
    const k = `${key(f.placeName)}|${f.sourceUrl}`;
    if (seen.has(k)) reasons.push({ path: `findings.${i}`, reason: "duplicate finding" });
    seen.add(k);
    if (!SELECTABLE.has(f.category)) {
      reasons.push({ path: `findings.${i}.category`, reason: "category not selectable" });
    }
  });
  return reasons;
}

function bandFor(req: EnrichRequest, cat: PlaceCategory): [number, number] | undefined {
  const group = cat.slice(0, cat.indexOf("."));
  return req.dwellBands[cat] ?? req.dwellBands[group];
}

function semanticEnrich(req: EnrichRequest, res: EnrichResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const requested = new Set(req.candidates.map((c) => c.id));
  const seen = new Set<string>();
  res.places.forEach((p, i) => {
    if (!requested.has(p.id)) reasons.push({ path: `places.${i}.id`, reason: "unknown id" });
    else if (seen.has(p.id)) reasons.push({ path: `places.${i}.id`, reason: "duplicate id" });
    seen.add(p.id);
    if (!SELECTABLE.has(p.primaryCategory)) {
      reasons.push({ path: `places.${i}.primaryCategory`, reason: "category not selectable" });
    }
    const band = bandFor(req, p.primaryCategory);
    if (band && (p.dwellMin < band[0] || p.dwellMin > band[1])) {
      reasons.push({
        path: `places.${i}.dwellMin`,
        reason: `dwell implausible for category (${p.primaryCategory} expects ${band[0]}–${band[1]})`,
      });
    }
    if (
      p.dwellMin < p.dwellRange[0] ||
      p.dwellMin > p.dwellRange[1] ||
      p.dwellRange[0] > p.dwellRange[1]
    ) {
      reasons.push({ path: `places.${i}.dwellRange`, reason: "dwellMin outside dwellRange" });
    }
    if (p.secondary.includes(p.primaryCategory)) {
      reasons.push({ path: `places.${i}.secondary`, reason: "secondary repeats primaryCategory" });
    }
  });
  for (const id of requested) {
    if (!seen.has(id)) reasons.push({ path: "places", reason: `missing id ${id}` });
  }
  return reasons;
}

function semanticStays(_req: StaysRequest, res: StaysResponse): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const seen = new Set<string>();
  res.zones.forEach((z, i) => {
    if (seen.has(key(z.name)))
      reasons.push({ path: `zones.${i}.name`, reason: `duplicate zone "${z.name}"` });
    seen.add(key(z.name));
  });
  return reasons;
}

export function validatePacketResponse(
  type: "areas",
  request: AreasRequest,
  raw: unknown,
): ValidationResult<AreasResponse>;
export function validatePacketResponse(
  type: "trends",
  request: TrendsRequest,
  raw: unknown,
): ValidationResult<TrendsResponse>;
export function validatePacketResponse(
  type: "enrich",
  request: EnrichRequest,
  raw: unknown,
): ValidationResult<EnrichResponse>;
export function validatePacketResponse(
  type: "stays",
  request: StaysRequest,
  raw: unknown,
): ValidationResult<StaysResponse>;
export function validatePacketResponse(
  type: PacketType,
  request: unknown,
  raw: unknown,
): ValidationResult<unknown>;
export function validatePacketResponse(
  type: PacketType,
  request: unknown,
  raw: unknown,
): ValidationResult<unknown> {
  const parsed = PACKET_SCHEMAS[type].response.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: zodReasons(parsed.error) };
  let reasons: RejectionReason[];
  switch (type) {
    case "areas":
      reasons = semanticAreas(request as AreasRequest, parsed.data as AreasResponse);
      break;
    case "trends":
      reasons = semanticTrends(request as TrendsRequest, parsed.data as TrendsResponse);
      break;
    case "enrich":
      reasons = semanticEnrich(request as EnrichRequest, parsed.data as EnrichResponse);
      break;
    case "stays":
      reasons = semanticStays(request as StaysRequest, parsed.data as StaysResponse);
      break;
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, data: parsed.data };
}
