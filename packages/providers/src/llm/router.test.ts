import { loadRegistry } from "@wayfare/domain";
import { InMemoryQuotaStore } from "./memoryQuotaStore";
import { ModelRouter } from "./router";
import { LlmError, type LlmProvider, type LlmRequest } from "./types";

const reg = loadRegistry({
  version: 1,
  models: [
    {
      id: "g1",
      provider: "google",
      modelId: "g1",
      enabled: true,
      capabilities: { jsonSchema: true, contextTokens: 1 },
      rank: { best: 1 },
    },
    {
      id: "g2",
      provider: "google",
      modelId: "g2",
      enabled: true,
      capabilities: { jsonSchema: true, contextTokens: 1 },
      rank: { best: 2 },
    },
    {
      id: "o1",
      provider: "openrouter",
      modelId: "o1",
      enabled: true,
      capabilities: { jsonSchema: false, contextTokens: 1 },
      rank: { best: 3 },
    },
  ],
});

type Script = Record<string, Array<"ok" | LlmError>>;
function scripted(id: "google" | "openrouter", script: Script): LlmProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    calls,
    async complete(modelId: string, _req: LlmRequest) {
      calls.push(modelId);
      const next = script[modelId]?.shift();
      if (next instanceof LlmError) throw next;
      return { text: `from ${modelId}`, modelId, provider: id };
    },
  };
}

const NOW = new Date("2026-09-20T12:00:00Z");

test("first healthy model wins", async () => {
  const google = scripted("google", { g1: ["ok"] });
  const res = await new ModelRouter({
    registry: reg,
    providers: { google },
    quota: new InMemoryQuotaStore(),
    now: () => NOW,
  }).run("best", { prompt: "x" });
  expect(res.modelEntryId).toBe("g1");
  expect(res.attempts.map((a) => a.outcome)).toEqual(["ok"]);
});

test("daily quota marks the model exhausted until the provider reset and falls through", async () => {
  const quota = new InMemoryQuotaStore();
  const google = scripted("google", { g1: [new LlmError("daily_quota", "day")], g2: ["ok"] });
  const res = await new ModelRouter({
    registry: reg,
    providers: { google },
    quota,
    now: () => NOW,
  }).run("best", { prompt: "x" });
  expect(res.modelEntryId).toBe("g2");
  expect(await quota.isExhausted("g1", NOW)).toBe(true);
  expect(quota.exhaustedUntil.get("g1")).toBe("2026-09-21T07:00:00.000Z");
});

test("exhausted models are skipped without calling the provider", async () => {
  const quota = new InMemoryQuotaStore();
  await quota.markExhausted("g1", "2999-01-01T00:00:00.000Z");
  const google = scripted("google", { g2: ["ok"] });
  const res = await new ModelRouter({
    registry: reg,
    providers: { google },
    quota,
    now: () => NOW,
  }).run("best", { prompt: "x" });
  expect(google.calls).toEqual(["g2"]);
  expect(res.attempts[0]).toMatchObject({ modelEntryId: "g1", outcome: "skipped_exhausted" });
});

test("per-minute rate limit retries once after sleeping, then moves on", async () => {
  const sleeps: number[] = [];
  const google = scripted("google", {
    g1: [
      new LlmError("rate_limit", "rpm", 429, 1500),
      new LlmError("rate_limit", "rpm", 429, 1500),
    ],
    g2: ["ok"],
  });
  const router = new ModelRouter({
    registry: reg,
    providers: { google },
    quota: new InMemoryQuotaStore(),
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const res = await router.run("best", { prompt: "x" });
  expect(sleeps).toEqual([1500]);
  expect(google.calls).toEqual(["g1", "g1", "g2"]);
  expect(res.modelEntryId).toBe("g2");
});

test("entries whose provider is not configured are skipped; a fully failed chain throws daily_quota", async () => {
  const google = scripted("google", {
    g1: [new LlmError("unavailable", "503")],
    g2: [new LlmError("auth", "401")],
  });
  await expect(
    new ModelRouter({
      registry: reg,
      providers: { google },
      quota: new InMemoryQuotaStore(),
      now: () => NOW,
    }).run("best", { prompt: "x" }),
  ).rejects.toMatchObject({ kind: "daily_quota" });
});

test("every real call is recorded in the quota store", async () => {
  const quota = new InMemoryQuotaStore();
  const google = scripted("google", { g1: [new LlmError("daily_quota", "day")], g2: ["ok"] });
  await new ModelRouter({ registry: reg, providers: { google }, quota, now: () => NOW }).run(
    "best",
    { prompt: "x" },
  );
  expect(quota.calls.map((c) => `${c.id}:${c.outcome}`)).toEqual(["g1:daily_quota", "g2:ok"]);
});

test("models without native jsonSchema get a prompt-enforced JSON instruction instead", async () => {
  const quota = new InMemoryQuotaStore();
  await quota.markExhausted("g1", "2999-01-01T00:00:00.000Z");
  await quota.markExhausted("g2", "2999-01-01T00:00:00.000Z");
  let seen: LlmRequest | undefined;
  const openrouter: LlmProvider = {
    id: "openrouter",
    async complete(modelId, req) {
      seen = req;
      return { text: "{}", modelId, provider: "openrouter" };
    },
  };
  await new ModelRouter({ registry: reg, providers: { openrouter }, quota, now: () => NOW }).run(
    "best",
    { prompt: "x", jsonSchema: { type: "object" } },
  );
  expect(seen?.jsonSchema).toBeUndefined();
  expect(seen?.system).toMatch(/Respond with JSON only/);
});
