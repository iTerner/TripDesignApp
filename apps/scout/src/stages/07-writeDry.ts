import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type EnrichedPlace,
  type Evidence,
  EvidenceSchema,
  effectivePlace,
  type PendingMerge,
  type Place,
  PlaceSchema,
  type Platform,
  type ScoutConfig,
  type StayZone,
} from "@wayfare/domain";
import type { IntelligenceBackend } from "../backend/types";
import { renderReport } from "../report";
import { completenessOf, fameScore, trendScore } from "../score";
import type { ResolvedDraft } from "./04-resolve";

export interface EvidenceInput {
  url: string;
  quote: string;
  quoteVerified: boolean;
  verifyReason?: string;
  platform: Platform;
  placeId: string;
  packetId?: string;
  approxDate?: string;
}

export interface DryWriteInput {
  outDir: string;
  slug: string;
  runId: string;
  now: Date;
  backendId: IntelligenceBackend["id"];
  cfg: ScoutConfig;
  drafts: readonly ResolvedDraft[];
  enrichments: ReadonlyMap<string, EnrichedPlace>;
  evidence: readonly EvidenceInput[];
  zones: readonly StayZone[];
  pendingMerges: readonly PendingMerge[];
  rejected: number;
  budget: { llmCalls: number; searches: number };
}

export interface DryWriteResult {
  places: number;
  trendingVerified: number;
  pendingMerges: number;
}

/** Dry-run pack writer. Reads no remote database. */
export function writeDryRun(input: DryWriteInput): DryWriteResult {
  const evidence = input.evidence.map((item) => toEvidence(item, input));
  const places = input.drafts.map((draft) => toPlace(draft, input, evidence));
  const effective = places.map((place) => effectivePlace(place));
  const active = effective.filter((place) => place.status === "active");
  const trendingVerified = evidence.filter((item) => item.quoteVerified).length;
  const summary = {
    places: active.length,
    trendingVerified,
    rejected: input.rejected,
    pendingMerges: input.pendingMerges.length,
    budget: input.budget,
  };
  writeJson(join(input.outDir, "places.json"), effective);
  writeJson(join(input.outDir, "evidence.json"), evidence);
  writeJson(join(input.outDir, "pending-merges.json"), input.pendingMerges);
  writeJson(join(input.outDir, "pack.json"), {
    slug: input.slug,
    places: active.map((place) => ({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      areaName: place.areaName,
      ...(place.primaryCategory !== undefined ? { primaryCategory: place.primaryCategory } : {}),
      fameScore: place.fameScore,
      trendScore: place.trendScore,
    })),
  });
  writeJson(join(input.outDir, "stayAreas.json"), { slug: input.slug, zones: input.zones });
  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(join(input.outDir, "run-report.md"), renderReport(summary), "utf8");
  return {
    places: summary.places,
    trendingVerified,
    pendingMerges: summary.pendingMerges,
  };
}

function toPlace(draft: ResolvedDraft, input: DryWriteInput, evidence: readonly Evidence[]): Place {
  const enrichment = input.enrichments.get(draft.placeId);
  const mine = evidence.filter((item) => item.placeId === draft.placeId);
  const primaryCategory = enrichment?.primaryCategory ?? draft.category;
  const place = PlaceSchema.parse({
    id: draft.placeId,
    destSlug: input.slug,
    name: draft.name,
    normalizedName: draft.normalizedName,
    geohash7: draft.geohash7,
    lat: draft.lat,
    lng: draft.lng,
    areaName: draft.areaName,
    primaryCategory,
    secondary: enrichment?.secondary ?? [],
    ...enrichmentFields(enrichment),
    bestTimeOfDay: enrichment?.bestTimeOfDay ?? [],
    ...(draft.openingHours !== undefined ? { openingHours: draft.openingHours } : {}),
    hoursStatus: draft.openingHours !== undefined ? "known" : "unknown",
    ...(draft.website !== undefined ? { website: draft.website } : {}),
    ...(draft.wikidataId !== undefined ? { wikidataId: draft.wikidataId } : {}),
    ...(draft.wikidataDesc !== undefined ? { wikidataDescription: draft.wikidataDesc } : {}),
    ...(draft.sitelinks !== undefined ? { sitelinks: draft.sitelinks } : {}),
    ...(draft.cuisine !== undefined ? { cuisine: draft.cuisine } : {}),
    ...(draft.image !== undefined ? { image: draft.image } : {}),
    fameScore: fameScore(
      {
        sitelinks: draft.sitelinks ?? 0,
        sourcesCount: draft.sources.length,
        completeness: completenessOf({
          ...(draft.openingHours !== undefined ? { openingHours: draft.openingHours } : {}),
          ...(draft.website !== undefined ? { website: draft.website } : {}),
          ...(draft.wikidataId !== undefined ? { wikidataId: draft.wikidataId } : {}),
          ...(draft.image !== undefined ? { image: draft.image } : {}),
          ...descriptionField(draft.wikidataDesc ?? enrichment?.blurb),
        }),
      },
      input.cfg,
    ),
    trendScore: trendScore(
      mine.map((item) => ({
        platform: item.platform,
        monthsOld: monthsOld(item.approxDate, input.now),
        quoteVerified: item.quoteVerified,
      })),
      input.cfg,
    ),
    sources: draft.sources,
    source: "scout",
    ...provenance(input.backendId),
    runId: input.runId,
    packetIds: draft.packetIds,
    aliases: draft.aliases,
    externalIds: {
      ...(draft.osmId !== undefined ? { osm: draft.osmId } : {}),
      ...(draft.wikidataId !== undefined ? { wikidata: draft.wikidataId } : {}),
      ...(draft.website !== undefined ? { website: draft.website } : {}),
    },
    verification: {
      geocoded: draft.geocoded,
      sourcesCount: draft.sources.length,
      quoteVerified: mine.some((item) => item.quoteVerified),
    },
    adminOverrides: draft.adminOverrides,
    status: draft.status,
    ...(draft.seen ? {} : { notSeenSince: input.now.toISOString() }),
    firstSeenAt: draft.firstSeenAt,
    lastSeenRunId: draft.seen ? input.runId : draft.lastSeenRunId,
    timesFlagged: draft.timesFlagged,
  });
  return place;
}

function enrichmentFields(enrichment: EnrichedPlace | undefined): Record<string, unknown> {
  if (enrichment === undefined) return {};
  return {
    dwellMin: enrichment.dwellMin,
    dwellRange: enrichment.dwellRange,
    effort: enrichment.effort,
    indoor: enrichment.indoor,
    needsBooking: enrichment.needsBooking,
    queueBufferMin: enrichment.queueBufferMin,
    kidFriendly: enrichment.kidFriendly,
    accessibility: enrichment.accessibility,
    priceLevel: enrichment.priceLevel,
    blurb: enrichment.blurb,
  };
}

function toEvidence(item: EvidenceInput, input: DryWriteInput): Evidence {
  return EvidenceSchema.parse({
    id: evidenceId(item.url, item.quote),
    placeId: item.placeId,
    url: item.url,
    platform: item.platform,
    quote: item.quote,
    quoteVerified: item.quoteVerified,
    ...(item.verifyReason !== undefined ? { verifyReason: item.verifyReason } : {}),
    ...(item.approxDate !== undefined ? { approxDate: item.approxDate } : {}),
    fetchedAt: input.now.toISOString(),
    backend: provenance(input.backendId).backend,
    runId: input.runId,
    ...(item.packetId !== undefined ? { packetId: item.packetId } : {}),
  });
}

function provenance(id: IntelligenceBackend["id"]): {
  backend: "gemini" | "agent";
  model?: string;
} {
  if (id === "gemini") return { backend: "gemini" };
  if (id === "agent") return { backend: "agent", model: "cursor-agent" };
  return { backend: "agent" };
}

function evidenceId(url: string, quote: string): string {
  return createHash("sha1")
    .update(`${url}|${normalisedQuote(quote)}`)
    .digest("hex");
}

function normalisedQuote(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function monthsOld(approx: string | undefined, now: Date): number | null {
  if (approx === undefined) return null;
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(approx);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = match[2] !== undefined ? Number(match[2]) - 1 : 0;
  const then = Date.UTC(year, month, 1);
  return Math.max(0, (now.getTime() - then) / (1000 * 60 * 60 * 24 * 30.4375));
}

function descriptionField(
  description: string | undefined,
): { description: string } | Record<string, never> {
  return description !== undefined ? { description } : {};
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
