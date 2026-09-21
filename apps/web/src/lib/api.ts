import { type ApiErrorCode, ApiErrorSchema } from "@wayfare/domain";
import type { ZodType } from "zod";

export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "";

export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (rest.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw new ApiClientError(
      parsed.success ? parsed.data.error : "internal",
      res.status,
      parsed.success ? parsed.data.message : `HTTP ${res.status}`,
    );
  }
  return schema.parse(json);
}
