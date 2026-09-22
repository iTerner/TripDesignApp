import { z } from "zod";
import { PlaceCategorySchema, PlatformSchema } from "../taxonomy/categories";

export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const BBoxSchema = z.strictObject({
  south: z.number().min(-90).max(90),
  west: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const DestinationKindSchema = z.enum(["city", "region", "country"]);
export type DestinationKind = z.infer<typeof DestinationKindSchema>;
export const AreaKindSchema = z.enum(["town", "zone", "countryside"]);
export type AreaKind = z.infer<typeof AreaKindSchema>;
export const AreaTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type AreaTier = z.infer<typeof AreaTierSchema>;
export const BackendIdSchema = z.enum(["gemini", "agent"]);
export type BackendId = z.infer<typeof BackendIdSchema>;

const Text = (max: number) => z.string().trim().min(1).max(max);
const HttpUrl = z.url({ protocol: /^https?$/ });

// ---- areas -------------------------------------------------------------------------------
export const AreasRequestSchema = z.strictObject({
  destination: z.strictObject({ slug: Text(64), name: Text(120), kind: DestinationKindSchema }),
  bbox: BBoxSchema,
  hints: z.array(Text(200)).max(20),
  minAreas: z.number().int().min(1),
  maxAreas: z.number().int().min(1).max(16),
});
export type AreasRequest = z.infer<typeof AreasRequestSchema>;

export const AreaSuggestionSchema = z.strictObject({
  name: Text(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  why: Text(300),
  kind: AreaKindSchema,
});
export type AreaSuggestion = z.infer<typeof AreaSuggestionSchema>;

export const AreasResponseSchema = z.strictObject({
  areas: z.array(AreaSuggestionSchema).min(1).max(16),
});
export type AreasResponse = z.infer<typeof AreasResponseSchema>;

// ---- trends ------------------------------------------------------------------------------
export const TrendsRequestSchema = z.strictObject({
  area: z.strictObject({
    name: Text(120),
    lat: z.number(),
    lng: z.number(),
    kind: AreaKindSchema,
    tier: AreaTierSchema,
  }),
  theme: Text(40),
  queries: z.array(Text(200)).min(1).max(5),
  maxFindings: z.number().int().min(1).max(40),
  year: z.number().int().min(2020).max(2100),
});
export type TrendsRequest = z.infer<typeof TrendsRequestSchema>;

export const TrendFindingSchema = z.strictObject({
  placeName: Text(120),
  category: PlaceCategorySchema,
  whyTrending: Text(400),
  sourceUrl: HttpUrl,
  platformMentioned: PlatformSchema,
  evidenceQuote: Text(240),
  approxDate: z
    .string()
    .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/)
    .optional(),
});
export type TrendFinding = z.infer<typeof TrendFindingSchema>;

export const TrendsResponseSchema = z.strictObject({
  findings: z.array(TrendFindingSchema).max(40),
});
export type TrendsResponse = z.infer<typeof TrendsResponseSchema>;

// ---- enrich ------------------------------------------------------------------------------
export const EnrichCandidateSchema = z.strictObject({
  id: Text(64),
  name: Text(120),
  lat: z.number(),
  lng: z.number(),
  osmTags: z.record(z.string(), z.string()),
  wikidataDesc: Text(500).optional(),
});
export type EnrichCandidate = z.infer<typeof EnrichCandidateSchema>;

export const EnrichRequestSchema = z.strictObject({
  candidates: z.array(EnrichCandidateSchema).min(1).max(30),
  taxonomy: z.array(PlaceCategorySchema).min(1),
  dwellBands: z.record(z.string(), z.tuple([z.number(), z.number()])),
});
export type EnrichRequest = z.infer<typeof EnrichRequestSchema>;

export const TimeOfDaySchema = z.enum(["morning", "midday", "afternoon", "evening", "night"]);
export const KidFriendlySchema = z.enum(["yes", "partial", "no"]);

export const EnrichedPlaceSchema = z.strictObject({
  id: Text(64),
  primaryCategory: PlaceCategorySchema,
  secondary: z.array(PlaceCategorySchema).max(3),
  dwellMin: z.number().int().positive(),
  dwellRange: z.tuple([z.number().int().min(0), z.number().int().positive()]),
  effort: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  indoor: z.boolean(),
  needsBooking: z.boolean(),
  queueBufferMin: z.number().int().min(0).max(240),
  bestTimeOfDay: z.array(TimeOfDaySchema).max(5),
  kidFriendly: KidFriendlySchema,
  accessibility: z.string().trim().max(300),
  priceLevel: z.number().int().min(0).max(4),
  blurb: Text(400),
});
export type EnrichedPlace = z.infer<typeof EnrichedPlaceSchema>;

export const EnrichResponseSchema = z.strictObject({
  places: z.array(EnrichedPlaceSchema).min(1).max(30),
});
export type EnrichResponse = z.infer<typeof EnrichResponseSchema>;

// ---- stays -------------------------------------------------------------------------------
export const StaysRequestSchema = z.strictObject({
  area: z.strictObject({ name: Text(120), lat: z.number(), lng: z.number(), kind: AreaKindSchema }),
  accommodations: z
    .array(
      z.strictObject({
        name: Text(120),
        lat: z.number(),
        lng: z.number(),
        tourism: Text(40),
        website: HttpUrl.optional(),
        stars: Text(10).optional(),
      }),
    )
    .max(60),
  areaFacts: z.array(Text(300)).max(20),
});
export type StaysRequest = z.infer<typeof StaysRequestSchema>;

export const StayZoneSchema = z.strictObject({
  name: Text(120),
  rationale: Text(400),
  exampleProperties: z
    .array(
      z.strictObject({
        name: Text(120),
        website: HttpUrl.optional(),
        priceLevel: z.number().int().min(0).max(4),
      }),
    )
    .min(1)
    .max(5),
});
export type StayZone = z.infer<typeof StayZoneSchema>;

export const StaysResponseSchema = z.strictObject({ zones: z.array(StayZoneSchema).min(1).max(4) });
export type StaysResponse = z.infer<typeof StaysResponseSchema>;

// ---- envelope ----------------------------------------------------------------------------
export const PacketTypeSchema = z.enum(["areas", "trends", "enrich", "stays"]);
export type PacketType = z.infer<typeof PacketTypeSchema>;

/** File-name safe by construction: no dots, slashes or spaces can pass. */
export const PACKET_ID_PATTERN = /^(areas|trends|enrich|stays)-\d{1,4}$/;
export const PacketIdSchema = z.string().regex(PACKET_ID_PATTERN, "packetId must be <type>-<n>");

export const PACKET_SCHEMAS = {
  areas: { request: AreasRequestSchema, response: AreasResponseSchema },
  trends: { request: TrendsRequestSchema, response: TrendsResponseSchema },
  enrich: { request: EnrichRequestSchema, response: EnrichResponseSchema },
  stays: { request: StaysRequestSchema, response: StaysResponseSchema },
} as const;

export const PacketRequestFileSchema = z.strictObject({
  packetId: PacketIdSchema,
  type: PacketTypeSchema,
  attempt: z.number().int().min(1),
  instructions: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
  payload: z.unknown(),
});
export type PacketRequestFile = z.infer<typeof PacketRequestFileSchema>;

export const RejectionReasonSchema = z.strictObject({
  path: z.string(),
  reason: z.string().min(1),
});
export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

export const PacketRejectionSchema = z.strictObject({
  packetId: PacketIdSchema,
  attempts: z.array(
    z.strictObject({
      attempt: z.number().int().min(1),
      at: z.iso.datetime(),
      /** sha1 of the rejected response text; an unchanged response is not re-counted. */
      responseSha1: z.string().length(40),
      reasons: z.array(RejectionReasonSchema).min(1),
    }),
  ),
});
export type PacketRejection = z.infer<typeof PacketRejectionSchema>;
