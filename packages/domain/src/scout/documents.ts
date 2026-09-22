import { z } from "zod";
import { PlaceCategorySchema, PlatformSchema } from "../taxonomy/categories";
import {
  AreaTierSchema,
  BackendIdSchema,
  BBoxSchema,
  DestinationKindSchema,
  KidFriendlySchema,
  LatLngSchema,
  RejectionReasonSchema,
  TimeOfDaySchema,
} from "./packets";

const Iso = z.iso.datetime();

// ---- destinations ---------------------------------------------------------------------------
export const DestinationGeometrySchema = z.strictObject({
  bbox: BBoxSchema,
  center: LatLngSchema,
  radiusKm: z.number().positive().optional(),
  /** Firestore path of the (possibly simplified) polygon document, spec §8.1. */
  polygonRef: z.string().optional(),
});
export type DestinationGeometry = z.infer<typeof DestinationGeometrySchema>;

export const DestinationStatusSchema = z.enum(["queued", "building", "ready", "stale", "failed"]);

export const DestinationSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  name: z.string().min(1),
  kind: DestinationKindSchema,
  geometry: DestinationGeometrySchema,
  queueOrder: z.number().int().min(0),
  status: DestinationStatusSchema,
  requestedBy: z.literal("admin"),
  lastRunId: z.string().optional(),
  counts: z.strictObject({
    scouted: z.number().int().min(0),
    userFound: z.number().int().min(0),
    trending: z.number().int().min(0),
    hidden: z.number().int().min(0),
  }),
  lock: z.strictObject({ runId: z.string(), startedAt: Iso }).optional(),
  hints: z.array(z.string()).optional(),
});
export type Destination = z.infer<typeof DestinationSchema>;

// ---- places -----------------------------------------------------------------------------------
export const PlaceSourceSchema = z.enum(["scout", "user_request", "admin"]);
export const PlaceStatusSchema = z.enum(["active", "hidden", "tombstoned", "unenriched"]);
export type PlaceStatus = z.infer<typeof PlaceStatusSchema>;
export const HoursStatusSchema = z.enum(["known", "unknown"]);
export const SourceRefSchema = z.strictObject({
  kind: z.enum(["osm", "wikidata", "web", "llm", "agent"]),
  ref: z.string().min(1),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
export const AdminOverrideSchema = z.strictObject({ value: z.unknown(), by: z.string(), at: Iso });
export const ExternalIdsSchema = z.strictObject({
  osm: z.string().optional(),
  wikidata: z.string().optional(),
  website: z.string().optional(),
});
export type ExternalIds = z.infer<typeof ExternalIdsSchema>;
export const VerificationSchema = z.strictObject({
  geocoded: z.boolean(),
  sourcesCount: z.number().int().min(0),
  quoteVerified: z.boolean(),
});
export const PlaceImageSchema = z.strictObject({
  url: z.url(),
  licence: z.string(),
  author: z.string(),
});

export const PlaceSchema = z.strictObject({
  id: z.string().min(1),
  destSlug: z.string().min(1),
  name: z.string().min(1),
  normalizedName: z.string(),
  geohash7: z.string().length(7),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  areaName: z.string().min(1),
  primaryCategory: PlaceCategorySchema.optional(),
  secondary: z.array(PlaceCategorySchema),
  dwellMin: z.number().int().positive().optional(),
  dwellRange: z.tuple([z.number().int().min(0), z.number().int().positive()]).optional(),
  effort: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  indoor: z.boolean().optional(),
  openingHours: z.string().optional(),
  hoursStatus: HoursStatusSchema,
  priceLevel: z.number().int().min(0).max(4).optional(),
  needsBooking: z.boolean().optional(),
  queueBufferMin: z.number().int().min(0).optional(),
  bestTimeOfDay: z.array(TimeOfDaySchema),
  kidFriendly: KidFriendlySchema.optional(),
  accessibility: z.string().optional(),
  website: z.string().optional(),
  wikidataId: z.string().optional(),
  wikidataDescription: z.string().optional(),
  sitelinks: z.number().int().min(0).optional(),
  cuisine: z.string().optional(),
  blurb: z.string().optional(),
  fameScore: z.number().min(0).max(100),
  trendScore: z.number().min(0).max(100),
  sources: z.array(SourceRefSchema),
  source: PlaceSourceSchema,
  backend: BackendIdSchema.optional(),
  model: z.string().optional(),
  runId: z.string(),
  packetIds: z.array(z.string()),
  aliases: z.array(z.string()),
  externalIds: ExternalIdsSchema,
  verification: VerificationSchema,
  adminOverrides: z.record(z.string(), AdminOverrideSchema),
  status: PlaceStatusSchema,
  mergedInto: z.string().optional(),
  image: PlaceImageSchema.optional(),
  firstSeenAt: Iso,
  lastSeenRunId: z.string(),
  notSeenSince: Iso.optional(),
  timesFlagged: z.number().int().min(0),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Base fields with each adminOverrides[field].value applied (spec §5). Unknown fields are ignored. */
export function effectivePlace(place: Place): Place {
  const out: Record<string, unknown> = { ...place };
  const known = new Set(Object.keys(PlaceSchema.shape));
  for (const [field, override] of Object.entries(place.adminOverrides)) {
    if (field === "adminOverrides" || !known.has(field)) continue;
    out[field] = override.value;
  }
  return PlaceSchema.parse(out);
}

// ---- evidence ---------------------------------------------------------------------------------
export const EvidenceSchema = z.strictObject({
  id: z.string().min(1),
  placeId: z.string().min(1),
  url: z.url(),
  platform: PlatformSchema,
  quote: z.string().min(1).max(240),
  quoteVerified: z.boolean(),
  verifyReason: z.string().optional(),
  approxDate: z.string().optional(),
  fetchedAt: Iso,
  backend: BackendIdSchema,
  runId: z.string(),
  packetId: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---- merges / runs / reviews -------------------------------------------------------------
export const PendingMergeSchema = z.strictObject({
  id: z.string().min(1),
  destSlug: z.string(),
  placeIdA: z.string(),
  placeIdB: z.string(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  status: z.enum(["open", "merged", "kept_both"]),
  resolvedBy: z.string().optional(),
  resolvedAt: Iso.optional(),
});
export type PendingMerge = z.infer<typeof PendingMergeSchema>;

export const StageRunSchema = z.strictObject({
  startedAt: Iso,
  finishedAt: Iso.optional(),
  counts: z.record(z.string(), z.number()),
});
export type StageRun = z.infer<typeof StageRunSchema>;

export const ScoutRunSchema = z.strictObject({
  runId: z.string(),
  destSlug: z.string(),
  backend: BackendIdSchema,
  startedBy: z.enum(["owner", "actions", "cursor"]),
  startedAt: Iso,
  finishedAt: Iso.optional(),
  stages: z.record(z.string(), StageRunSchema),
  budget: z.strictObject({ llmCalls: z.number().int().min(0), searches: z.number().int().min(0) }),
  rejectedPackets: z.array(
    z.strictObject({
      packetId: z.string(),
      attempt: z.number().int(),
      reasons: z.array(RejectionReasonSchema),
    }),
  ),
  errors: z.array(z.string()),
  reportMarkdown: z.string().optional(),
  forced: z.boolean().optional(),
});
export type ScoutRun = z.infer<typeof ScoutRunSchema>;

export const ReviewSessionSchema = z.strictObject({
  id: z.string(),
  destSlug: z.string(),
  runId: z.string(),
  sample: z.array(z.strictObject({ placeId: z.string(), bucket: z.enum(["random", "topTrend"]) })),
  verdicts: z.record(z.string(), z.string().regex(/^(correct|hide|wrong:.+)$/)),
  accuracy: z.number().min(0).max(1),
  startedAt: Iso,
  completedAt: Iso.optional(),
});
export type ReviewSession = z.infer<typeof ReviewSessionSchema>;

/** Stage-1 area with the CLI's verified coordinates and harvest bbox (work/<dest>/01-areas.json). */
export const AreaRecordSchema = z.strictObject({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  lat: z.number(),
  lng: z.number(),
  kind: z.enum(["town", "zone", "countryside"]),
  why: z.string(),
  bbox: BBoxSchema,
  wikidataId: z.string().optional(),
  sitelinks: z.number().int().min(0).optional(),
  tier: AreaTierSchema.optional(),
  packetId: z.string(),
});
export type AreaRecord = z.infer<typeof AreaRecordSchema>;
