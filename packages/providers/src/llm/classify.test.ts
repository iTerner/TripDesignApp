import { classifyHttpError } from "./classify";

test("gemini 429 mentioning per-day quota is daily_quota", () => {
  const body = JSON.stringify({
    error: {
      message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, per day",
    },
  });
  expect(classifyHttpError("google", 429, body, null).kind).toBe("daily_quota");
});

test("gemini 429 per-minute is rate_limit with retryAfter from header", () => {
  const e = classifyHttpError(
    "google",
    429,
    JSON.stringify({ error: { message: "Resource exhausted: requests per minute" } }),
    "7",
  );
  expect(e.kind).toBe("rate_limit");
  expect(e.retryAfterMs).toBe(7000);
});

test("openrouter 429 mentioning the daily free pool is daily_quota", () => {
  const body = JSON.stringify({
    error: {
      message:
        "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    },
  });
  expect(classifyHttpError("openrouter", 429, body, null).kind).toBe("daily_quota");
});

function geminiQuotaBody(quotaId: string): string {
  return JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
              quotaId,
            },
          ],
        },
      ],
    },
  });
}

test("gemini structured QuotaFailure with a PerDay quotaId is daily_quota", () => {
  const body = geminiQuotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier");
  expect(classifyHttpError("google", 429, body, null).kind).toBe("daily_quota");
});

test("gemini structured QuotaFailure with a PerMinute quotaId is rate_limit", () => {
  const body = geminiQuotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier");
  const e = classifyHttpError("google", 429, body, null);
  expect(e.kind).toBe("rate_limit");
  expect(e.retryAfterMs).toBe(5000);
});

test("non-JSON 429 body containing PerDay is daily_quota", () => {
  const body = "quota GenerateRequestsPerDayPerProjectPerModel-FreeTier exceeded";
  expect(classifyHttpError("google", 429, body, null).kind).toBe("daily_quota");
});

test("401/403 are auth; 5xx unavailable; 400 invalid_request", () => {
  expect(classifyHttpError("google", 401, "", null).kind).toBe("auth");
  expect(classifyHttpError("openrouter", 503, "", null).kind).toBe("unavailable");
  expect(classifyHttpError("google", 400, "", null).kind).toBe("invalid_request");
});
