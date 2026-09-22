import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AreasRequest,
  DEFAULT_SCOUT_CONFIG,
  type EnrichRequest,
  packetJsonSchema,
  SELECTABLE_CATEGORIES,
  type StaysRequest,
  type TrendsRequest,
} from "@wayfare/domain";
import { LlmError, type LlmRequest, type ModelRouter } from "@wayfare/providers";
import { createFakeBackend } from "./fake";
import { createGeminiBackend } from "./gemini";
import { BudgetExceeded } from "./types";

const areasReq: AreasRequest = {
  destination: { slug: "tuscany", name: "Tuscany", kind: "region" },
  bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 },
  hints: [],
  minAreas: 2,
  maxAreas: 16,
};

const areasBody = {
  areas: [
    { name: "Florence", lat: 43.77, lng: 11.25, why: "Renaissance capital", kind: "town" as const },
    { name: "Siena", lat: 43.32, lng: 11.33, why: "Medieval hill town", kind: "town" as const },
  ],
};

const trendsReq = (queries: string[]): TrendsRequest => ({
  area: { name: "Florence", lat: 43.77, lng: 11.25, kind: "town", tier: 1 },
  theme: "dessert",
  queries,
  maxFindings: 4,
  year: 2026,
});

const enrichReq: EnrichRequest = {
  candidates: [
    { id: "pl_a", name: "Museo Galileo", lat: 43.76, lng: 11.25, osmTags: { tourism: "museum" } },
  ],
  taxonomy: [...SELECTABLE_CATEGORIES],
  dwellBands: { "culture.museum": [60, 240] as [number, number] },
};

const enrichBody = {
  places: [
    {
      id: "pl_a",
      primaryCategory: "culture.museum",
      secondary: [],
      dwellMin: 90,
      dwellRange: [60, 150],
      effort: 2,
      indoor: true,
      needsBooking: false,
      queueBufferMin: 15,
      bestTimeOfDay: ["morning"],
      kidFriendly: "partial",
      accessibility: "step-free entrance",
      priceLevel: 2,
      blurb: "Instruments and a room of Galileo's own tools.",
    },
  ],
};

const staysReq: StaysRequest = {
  area: { name: "Florence", lat: 43.7, lng: 11.2, kind: "town" },
  accommodations: [],
  areaFacts: [],
};

const staysBody = {
  zones: [
    {
      name: "Oltrarno",
      rationale: "Quiet streets south of the river, walkable to dinner.",
      exampleProperties: [{ name: "Hotel Lucchesi", priceLevel: 3 }],
    },
  ],
};

const promptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/domain/prompts/scout",
);

function routerResult(text: string) {
  return {
    text,
    modelId: "gemini-test",
    provider: "google" as const,
    modelEntryId: "g1",
    attempts: [],
  };
}

function gemini(opts: {
  run: ModelRouter["run"];
  search?: (query: string) => Promise<{ url: string; title: string; rawContent?: string }[]>;
  fetchPage?: (
    url: string,
  ) => Promise<{ text: string; quoteAllowed: boolean } | { skipped: string }>;
  budget?: { llmCalls: number; searches: number };
  limits?: { llm: number; searches: number };
}) {
  const budget = opts.budget ?? { llmCalls: 0, searches: 0 };
  const limits = opts.limits ?? { llm: DEFAULT_SCOUT_CONFIG.budgetLlmCalls, searches: 60 };
  const search = vi.fn(opts.search ?? (async () => []));
  const fetchPage = vi.fn(
    opts.fetchPage ?? (async () => ({ skipped: "not-used" }) as { skipped: string }),
  );
  const backend = createGeminiBackend({
    router: { run: opts.run } as ModelRouter,
    search: { search },
    fetchPage,
    budget,
    limits,
  });
  return { backend, budget, search, fetchPage };
}

function routerRequest(calls: ReadonlyArray<readonly unknown[]>, index: number): LlmRequest {
  const call = calls[index];
  if (!call) throw new Error(`missing router call ${index}`);
  return call[1] as LlmRequest;
}

test("fake backend returns the recorded object for the packet type", async () => {
  const areas = { areas: areasBody.areas };
  const trends = { findings: [] };
  const enrich = { places: enrichBody.places };
  const stays = { zones: staysBody.zones };
  const fake = createFakeBackend({ areas, trends, enrich, stays });
  expect(fake.id).toBe("fake");
  await expect(fake.listAreas(areasReq)).resolves.toBe(areas);
  await expect(fake.extractTrends(trendsReq(["gelato"]), [])).resolves.toBe(trends);
  await expect(fake.enrichBatch(enrichReq)).resolves.toBe(enrich);
  await expect(fake.suggestStays(staysReq)).resolves.toBe(stays);
});

test("gemini listAreas calls the extract chain with the areas schema", async () => {
  const run = vi.fn(async (_task: string, _req: LlmRequest) =>
    routerResult(JSON.stringify(areasBody)),
  );
  const { backend } = gemini({ run });
  await expect(backend.listAreas(areasReq)).resolves.toEqual(areasBody);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toBe("extract");
  const req = routerRequest(run.mock.calls, 0);
  expect(req.jsonSchema).toEqual(packetJsonSchema("areas"));
  expect(req.system).toBe(readFileSync(join(promptsDir, "areas.md"), "utf8"));
  expect(backend.id).toBe("gemini");
});

test("gemini retries once without jsonSchema when the model rejects strict mode", async () => {
  const schema = packetJsonSchema("areas");
  const seen: LlmRequest[] = [];
  const run = vi.fn(async (_task: string, req: LlmRequest) => {
    seen.push(req);
    if (seen.length === 1) throw new LlmError("invalid_request", "strict json_schema rejected");
    return routerResult(JSON.stringify(areasBody));
  });
  const { backend } = gemini({ run });
  await expect(backend.listAreas(areasReq)).resolves.toEqual(areasBody);
  expect(run).toHaveBeenCalledTimes(2);
  expect(seen[0]?.jsonSchema).toEqual(schema);
  expect(seen[1]?.jsonSchema).toBeUndefined();
  expect(Object.hasOwn(seen[1] ?? {}, "jsonSchema")).toBe(false);
  expect(seen[1]?.system?.startsWith(seen[0]?.system ?? "")).toBe(true);
  expect(seen[1]?.system).toContain(JSON.stringify(schema));
});

test("a non-schema LlmError is not retried", async () => {
  const run = vi.fn(async () => {
    throw new LlmError("unavailable", "upstream down");
  });
  const { backend, budget } = gemini({ run });
  await expect(backend.listAreas(areasReq)).rejects.toMatchObject({ kind: "unavailable" });
  expect(run).toHaveBeenCalledTimes(1);
  expect(budget.llmCalls).toBe(1);
});

test("the 81st LLM call throws BudgetExceeded and does not call run", async () => {
  expect(DEFAULT_SCOUT_CONFIG.budgetLlmCalls).toBe(80);
  const run = vi.fn(async () => routerResult(JSON.stringify(areasBody)));
  const { backend } = gemini({
    run,
    limits: { llm: DEFAULT_SCOUT_CONFIG.budgetLlmCalls, searches: 60 },
  });
  for (let n = 0; n < 80; n += 1) {
    await backend.listAreas(areasReq);
  }
  expect(run).toHaveBeenCalledTimes(80);
  await expect(backend.listAreas(areasReq)).rejects.toBeInstanceOf(BudgetExceeded);
  expect(run).toHaveBeenCalledTimes(80);
});

test("unparseable model text counts as an LLM call and throws LlmError other", async () => {
  const run = vi.fn(async () => routerResult("not json"));
  const { backend, budget } = gemini({ run });
  await expect(backend.listAreas(areasReq)).rejects.toMatchObject({
    name: "LlmError",
    kind: "other",
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(budget.llmCalls).toBe(1);
});

test("extractTrends searches at most searchesPerPacket times and truncates page text", async () => {
  const perPacket = DEFAULT_SCOUT_CONFIG.searchesPerPacket;
  const maxChars = DEFAULT_SCOUT_CONFIG.extractMaxChars;
  expect(perPacket).toBe(2);
  const queries = ["q1", "q2", "q3", "q4", "q5"];
  const run = vi.fn(async (_task: string, _req: LlmRequest) =>
    routerResult(JSON.stringify({ findings: [] })),
  );
  const { backend, search } = gemini({
    run,
    search: async (query) => [
      { url: `https://example.com/${query}`, title: query, rawContent: `HIT_${query}` },
    ],
  });
  const filler = "B".repeat(maxChars);
  const pages = [{ url: "https://example.com/long", text: `${filler}TRUNCATE_ME` }];
  await expect(backend.extractTrends(trendsReq(queries), pages)).resolves.toEqual({ findings: [] });
  expect(search).toHaveBeenCalledTimes(perPacket);
  expect(search.mock.calls.map((c) => c[0])).toEqual(queries.slice(0, perPacket));
  const sent = routerRequest(run.mock.calls, 0);
  expect(sent.jsonSchema).toEqual(packetJsonSchema("trends"));
  expect(sent.system).toBe(readFileSync(join(promptsDir, "trends.md"), "utf8"));
  const prompt = sent.prompt;
  const hitAt = prompt.indexOf("HIT_q1");
  expect(hitAt).toBeGreaterThan(-1);
  const pageText = prompt.slice(hitAt);
  expect(pageText.length).toBeLessThanOrEqual(maxChars);
  expect(pageText).toContain("HIT_q2");
  expect(pageText).not.toContain("TRUNCATE_ME");
  expect(run.mock.calls[0]?.[0]).toBe("extract");
});

test("extractTrends fetches pages when a hit has no raw content", async () => {
  const run = vi.fn(async () => routerResult(JSON.stringify({ findings: [] })));
  const fetchPage = vi.fn(async () => ({ text: "fetched body", quoteAllowed: true }));
  const { backend, search } = gemini({
    run,
    search: async () => [{ url: "https://example.com/page", title: "Page" }],
    fetchPage,
  });
  await backend.extractTrends(trendsReq(["only"]), []);
  expect(search).toHaveBeenCalledTimes(1);
  expect(fetchPage).toHaveBeenCalledWith("https://example.com/page", expect.any(Object));
  expect(routerRequest(run.mock.calls, 0).prompt).toContain("fetched body");
});

test("enrichBatch and suggestStays use the extract chain", async () => {
  const run = vi.fn(async (_task: string, req: LlmRequest) => {
    const prompt = req.prompt;
    if (prompt.includes("pl_a")) return routerResult(JSON.stringify(enrichBody));
    return routerResult(JSON.stringify(staysBody));
  });
  const { backend } = gemini({ run });
  await expect(backend.enrichBatch(enrichReq)).resolves.toEqual(enrichBody);
  await expect(backend.suggestStays(staysReq)).resolves.toEqual(staysBody);
  expect(run.mock.calls.map((c) => c[0])).toEqual(["extract", "extract"]);
  const enrichCall = routerRequest(run.mock.calls, 0);
  const staysCall = routerRequest(run.mock.calls, 1);
  expect(enrichCall.jsonSchema).toEqual(packetJsonSchema("enrich"));
  expect(staysCall.jsonSchema).toEqual(packetJsonSchema("stays"));
  expect(enrichCall.system).toBe(readFileSync(join(promptsDir, "enrich.md"), "utf8"));
  expect(staysCall.system).toBe(readFileSync(join(promptsDir, "stays.md"), "utf8"));
});
