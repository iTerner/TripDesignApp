import type { ProviderId } from "@wayfare/domain";
import { LlmError } from "./types";

const DAILY = [/per day/i, /daily/i, /free-models-per-day/i, /requests_per_day/i, /\bRPD\b/];
const MINUTE = [/per minute/i, /requests_per_minute/i, /\bRPM\b/, /tokens per minute/i];

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
    const daily = DAILY.some((p) => p.test(bodyText));
    const minute = MINUTE.some((p) => p.test(bodyText));
    if (daily && !minute) return new LlmError("daily_quota", msg, status);
    return new LlmError("rate_limit", msg, status, retryAfterMs ?? 5000);
  }
  if (status >= 500) return new LlmError("unavailable", msg, status, retryAfterMs);
  if (status >= 400) return new LlmError("invalid_request", msg, status);
  return new LlmError("other", msg, status);
}
