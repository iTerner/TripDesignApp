import { z } from "zod";

export const ApiErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "reauth_required",
  "bad_request",
  "not_found",
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
