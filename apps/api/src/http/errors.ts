import type { ApiErrorCode } from "@wayfare/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
): Response {
  return c.json({ error: code, message }, status);
}
