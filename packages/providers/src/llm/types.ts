import type { ProviderId } from "@wayfare/domain";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LlmRequest {
  system?: string;
  prompt: string;
  /** JSON Schema for the response. Providers without native support get prompt-enforced JSON (router). */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResult {
  text: string;
  modelId: string;
  provider: ProviderId;
}

export type LlmErrorKind =
  | "daily_quota"
  | "rate_limit"
  | "invalid_request"
  | "unavailable"
  | "auth"
  | "other";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  readonly id: ProviderId;
  complete(modelId: string, req: LlmRequest): Promise<LlmResult>;
}
