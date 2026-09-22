import {
  type AreasRequest,
  type AreasResponse,
  DEFAULT_SCOUT_CONFIG,
  type EnrichRequest,
  type EnrichResponse,
  type PacketType,
  packetJsonSchema,
  type StaysRequest,
  type StaysResponse,
  type TrendsRequest,
  type TrendsResponse,
  validatePacketResponse,
} from "@wayfare/domain";
import { LlmError, type LlmRequest, type ModelRouter } from "@wayfare/providers";
import {
  BudgetExceeded,
  type FetchPageFn,
  type IntelligenceBackend,
  readScoutPrompt,
  type SearchProvider,
} from "./types";

export interface GeminiBackendOpts {
  router: ModelRouter;
  search: SearchProvider;
  fetchPage: FetchPageFn;
  budget: { llmCalls: number; searches: number };
  limits: { llm: number; searches: number };
}

export function createGeminiBackend(opts: GeminiBackendOpts): IntelligenceBackend {
  async function runModel(
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<string> {
    const first: LlmRequest = { system, prompt, jsonSchema: schema };
    try {
      return await chargeAndRun(first);
    } catch (err) {
      if (!(err instanceof LlmError) || err.kind !== "invalid_request") throw err;
      const retry: LlmRequest = { system: `${system}\n\n${JSON.stringify(schema)}`, prompt };
      return chargeAndRun(retry);
    }
  }

  async function chargeAndRun(req: LlmRequest): Promise<string> {
    if (opts.budget.llmCalls >= opts.limits.llm) throw new BudgetExceeded("llm");
    opts.budget.llmCalls += 1;
    const result = await opts.router.run("extract", req);
    return result.text;
  }

  async function complete<T>(type: PacketType, request: unknown, pageText?: string): Promise<T> {
    const schema = packetJsonSchema(type);
    const system = readScoutPrompt(type);
    const payload = JSON.stringify(request);
    const prompt = pageText ? `${payload}\n\n${pageText}` : payload;
    const text = await runModel(system, prompt, schema);
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new LlmError("other", `Model returned non-JSON for ${type}`);
    }
    const validated = validatePacketResponse(type, request, raw);
    if (!validated.ok) {
      const detail = validated.reasons.map((r) => `${r.path}: ${r.reason}`).join("; ");
      throw new LlmError("other", `Invalid ${type} response: ${detail}`);
    }
    return validated.data as T;
  }

  return {
    id: "gemini",
    listAreas(req: AreasRequest): Promise<AreasResponse> {
      return complete("areas", req);
    },
    async extractTrends(
      req: TrendsRequest,
      pages: { url: string; text: string }[],
    ): Promise<TrendsResponse> {
      const parts = await collectPages(opts, req, pages);
      const blob = truncatePages(parts, DEFAULT_SCOUT_CONFIG.extractMaxChars);
      return complete("trends", req, blob);
    },
    enrichBatch(req: EnrichRequest): Promise<EnrichResponse> {
      return complete("enrich", req);
    },
    suggestStays(req: StaysRequest): Promise<StaysResponse> {
      return complete("stays", req);
    },
  };
}

async function collectPages(
  opts: GeminiBackendOpts,
  req: TrendsRequest,
  pages: { url: string; text: string }[],
): Promise<{ url: string; text: string }[]> {
  const room = Math.max(0, opts.limits.searches - opts.budget.searches);
  const cap = Math.min(DEFAULT_SCOUT_CONFIG.searchesPerPacket, room, req.queries.length);
  const parts: { url: string; text: string }[] = [];
  for (let i = 0; i < cap; i += 1) {
    const query = req.queries[i];
    if (query === undefined) break;
    opts.budget.searches += 1;
    const hits = await opts.search.search(query);
    for (const hit of hits) {
      const fetched = await opts.fetchPage(hit.url, {
        fetchImpl: globalThis.fetch,
        cfg: DEFAULT_SCOUT_CONFIG,
      });
      if (!("text" in fetched) || !fetched.quoteAllowed) continue;
      const text = typeof hit.rawContent === "string" ? hit.rawContent : fetched.text;
      parts.push({ url: hit.url, text });
    }
  }
  parts.push(...pages);
  return parts;
}

function truncatePages(parts: { url: string; text: string }[], maxChars: number): string {
  const joined = parts.map((p) => `# ${p.url}\n${p.text}`).join("\n\n");
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars);
}
