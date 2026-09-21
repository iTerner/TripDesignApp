import type { ProviderId } from "@wayfare/domain";
import { LlmError } from "./types";

const DAILY = [
  /per day/i,
  /daily/i,
  /free-models-per-day/i,
  /requests_per_day/i,
  /\bRPD\b/,
  /PerDay/,
  /per_?day/i,
];
const MINUTE = [
  /per minute/i,
  /requests_per_minute/i,
  /\bRPM\b/,
  /tokens per minute/i,
  /PerMinute/,
  /per_?minute/i,
];

/**
 * Google API errors carry structured `google.rpc.QuotaFailure` details whose `quotaId`
 * names the window (e.g. "GenerateRequestsPerDayPerProjectPerModel-FreeTier").
 * Returns the kind decided from those ids, or undefined when the body is not such JSON.
 */
function kindFromQuotaIds(bodyText: string): "daily_quota" | "rate_limit" | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const details = (parsed as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return undefined;
  const quotaIds: string[] = [];
  for (const d of details) {
    const violations = (d as { violations?: unknown } | null)?.violations;
    if (!Array.isArray(violations)) continue;
    for (const v of violations) {
      const quotaId = (v as { quotaId?: unknown } | null)?.quotaId;
      if (typeof quotaId === "string") quotaIds.push(quotaId);
    }
  }
  if (quotaIds.some((q) => q.includes("PerDay"))) return "daily_quota";
  if (quotaIds.some((q) => q.includes("PerMinute"))) return "rate_limit";
  return undefined;
}

export function classifyHttpError(
  provider: ProviderId,
  status: number,
  bodyText: string,
  retryAfterHeader: string | null,
): LlmError {
  const retryAfterMs =
    retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
      ? Number(retryAfterHeader) * 1000
      : undefined;
  const msg = `${provider} HTTP ${status}: ${bodyText.slice(0, 300)}`;
  if (status === 401 || status === 403) return new LlmError("auth", msg, status);
  if (status === 429) {
    const fromQuotaId = kindFromQuotaIds(bodyText);
    if (fromQuotaId === "daily_quota") return new LlmError("daily_quota", msg, status);
    if (fromQuotaId === "rate_limit") {
      return new LlmError("rate_limit", msg, status, retryAfterMs ?? 5000);
    }
    const daily = DAILY.some((p) => p.test(bodyText));
    const minute = MINUTE.some((p) => p.test(bodyText));
    if (daily && !minute) return new LlmError("daily_quota", msg, status);
    return new LlmError("rate_limit", msg, status, retryAfterMs ?? 5000);
  }
  if (status >= 500) return new LlmError("unavailable", msg, status, retryAfterMs);
  if (status >= 400) return new LlmError("invalid_request", msg, status);
  return new LlmError("other", msg, status);
}
