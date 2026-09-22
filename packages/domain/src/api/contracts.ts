import { z } from "zod";
import { DestinationGeometrySchema, PlaceSchema } from "../scout/documents";
import { DestinationKindSchema } from "../scout/packets";

export const ApiErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "reauth_required",
  "bad_request",
  "not_found",
  "conflict",
  "not_implemented",
  "rate_limited",
  "upstream_exhausted",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorSchema = z.object({ error: ApiErrorCode, message: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PingResponseSchema = z.object({
  ok: z.literal(true),
  uid: z.string().min(1),
  serverTime: z.string().datetime(),
  /** true when this request created the users/{uid} document. */
  firstSeen: z.boolean(),
});
export type PingResponse = z.infer<typeof PingResponseSchema>;

export const AdminPingResponseSchema = z.object({
  ok: z.literal(true),
  uid: z.string().min(1),
  authAgeSec: z.number().int().min(0),
});
export type AdminPingResponse = z.infer<typeof AdminPingResponseSchema>;

export const LlmPingResponseSchema = z.object({
  ok: z.literal(true),
  modelUsed: z.string(),
  provider: z.string(),
  attempts: z.array(z.object({ modelId: z.string(), outcome: z.string() })),
  text: z.string(),
});
export type LlmPingResponse = z.infer<typeof LlmPingResponseSchema>;

const Slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{2,64}$/);

/** Place fields the override route may write. `status` is hide-only; `by` is set by the Worker. */
const BLOCKED_OVERRIDE_FIELDS = new Set([
  "id",
  "destSlug",
  "status",
  "adminOverrides",
  "mergedInto",
]);

export const CreateDestinationRequestSchema = z.strictObject({
  slug: Slug,
  name: z.string().trim().min(1).max(120),
  kind: DestinationKindSchema,
  geometry: DestinationGeometrySchema.optional(),
  hints: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});
export type CreateDestinationRequest = z.infer<typeof CreateDestinationRequestSchema>;

export const CreateDestinationResponseSchema = z.strictObject({
  ok: z.literal(true),
  slug: Slug,
  status: z.literal("queued"),
  queueOrder: z.number().int().min(0),
});
export type CreateDestinationResponse = z.infer<typeof CreateDestinationResponseSchema>;

export const ReorderDestinationsRequestSchema = z
  .strictObject({
    slugs: z.array(Slug).min(1).max(200),
  })
  .superRefine((body, ctx) => {
    if (new Set(body.slugs).size !== body.slugs.length) {
      ctx.addIssue({ code: "custom", message: "duplicate slug" });
    }
  });
export type ReorderDestinationsRequest = z.infer<typeof ReorderDestinationsRequestSchema>;

export const ReorderDestinationsResponseSchema = z.strictObject({
  ok: z.literal(true),
  order: z.array(
    z.strictObject({
      slug: Slug,
      queueOrder: z.number().int().min(0),
    }),
  ),
});
export type ReorderDestinationsResponse = z.infer<typeof ReorderDestinationsResponseSchema>;

export const DeleteDestinationResponseSchema = z.strictObject({
  ok: z.literal(true),
  slug: Slug,
});
export type DeleteDestinationResponse = z.infer<typeof DeleteDestinationResponseSchema>;

export const PlaceOverrideRequestSchema = z
  .strictObject({
    field: z.string().trim().min(1).max(64),
    value: z.unknown(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((body, ctx) => {
    if (BLOCKED_OVERRIDE_FIELDS.has(body.field) || !(body.field in PlaceSchema.shape)) {
      ctx.addIssue({ code: "custom", path: ["field"], message: "field cannot be overridden" });
      return;
    }
    const fieldSchema = PlaceSchema.shape[body.field as keyof typeof PlaceSchema.shape];
    if (!fieldSchema.safeParse(body.value).success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "value does not match field" });
    }
  });
export type PlaceOverrideRequest = z.infer<typeof PlaceOverrideRequestSchema>;

export const PlaceOverrideResponseSchema = z.strictObject({
  ok: z.literal(true),
  id: z.string().min(1),
  field: z.string().min(1),
});
export type PlaceOverrideResponse = z.infer<typeof PlaceOverrideResponseSchema>;

export const PlaceHideRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(2000),
});
export type PlaceHideRequest = z.infer<typeof PlaceHideRequestSchema>;

export const PlaceHideResponseSchema = z.strictObject({
  ok: z.literal(true),
  id: z.string().min(1),
  status: z.literal("hidden"),
});
export type PlaceHideResponse = z.infer<typeof PlaceHideResponseSchema>;

export const ResolveMergeRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("merge"), keep: z.enum(["a", "b"]) }),
  z.strictObject({ action: z.literal("keep_both") }),
]);
export type ResolveMergeRequest = z.infer<typeof ResolveMergeRequestSchema>;

export const ResolveMergeResponseSchema = z.strictObject({
  ok: z.literal(true),
  id: z.string().min(1),
  status: z.enum(["merged", "kept_both"]),
});
export type ResolveMergeResponse = z.infer<typeof ResolveMergeResponseSchema>;

export const CreateReviewRequestSchema = z.strictObject({
  destSlug: Slug,
  runId: z.string().trim().min(1).max(128),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const CreateReviewResponseSchema = z.strictObject({
  ok: z.literal(true),
  id: z.string().min(1),
  sampleSize: z.number().int().min(0).max(60),
});
export type CreateReviewResponse = z.infer<typeof CreateReviewResponseSchema>;

export const ReviewWrongReasonSchema = z.enum([
  "closed",
  "wrong_category",
  "wrong_place",
  "bad_time",
  "bad_quote",
  "other",
]);
export type ReviewWrongReason = z.infer<typeof ReviewWrongReasonSchema>;

export const ReviewVerdictRequestSchema = z.discriminatedUnion("verdict", [
  z.strictObject({ placeId: z.string().trim().min(1).max(200), verdict: z.literal("correct") }),
  z.strictObject({ placeId: z.string().trim().min(1).max(200), verdict: z.literal("hide") }),
  z.strictObject({
    placeId: z.string().trim().min(1).max(200),
    verdict: z.literal("wrong"),
    reason: ReviewWrongReasonSchema,
  }),
]);
export type ReviewVerdictRequest = z.infer<typeof ReviewVerdictRequestSchema>;

export const ReviewVerdictResponseSchema = z.strictObject({
  ok: z.literal(true),
  id: z.string().min(1),
  accuracy: z.number().min(0).max(1),
  completed: z.boolean(),
});
export type ReviewVerdictResponse = z.infer<typeof ReviewVerdictResponseSchema>;
