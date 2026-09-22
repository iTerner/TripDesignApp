import type { ScoutConfig } from "@wayfare/domain";

export interface SearchHit {
  url: string;
  title: string;
  rawContent?: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchHit[]>;
}

/** Same call shape as SearchProvider. The live Gemini grounding adapter is Part B. */
export interface GroundingSearch extends SearchProvider {}

export class SearchError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super(status === null ? "tavily request failed" : `tavily status ${status}`);
    this.name = "SearchError";
    this.status = status;
  }
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export function createTavilySearch(
  apiKey: string,
  fetchImpl: typeof fetch,
  cfg: ScoutConfig,
): SearchProvider {
  return {
    async search(query: string): Promise<SearchHit[]> {
      let res: Response;
      try {
        res = await fetchImpl(TAVILY_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query,
            search_depth: "advanced",
            include_raw_content: true,
            max_results: cfg.searchMaxResults,
          }),
          signal: AbortSignal.timeout(cfg.fetch.timeoutMs),
        });
      } catch {
        throw new SearchError(null);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new SearchError(res.status);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new SearchError(res.status);
      }
      return hitsFromBody(body);
    },
  };
}

/** Records a search failure on `errors` and skips the packet instead of failing the destination. */
export async function runPacketSearch(
  provider: SearchProvider,
  queries: readonly string[],
  errors: string[],
): Promise<{ hits: SearchHit[] } | { skipped: "search" }> {
  const hits: SearchHit[] = [];
  for (const query of queries) {
    try {
      hits.push(...(await provider.search(query)));
    } catch (err) {
      errors.push(err instanceof SearchError ? err.message : "tavily request failed");
      return { skipped: "search" };
    }
  }
  return { hits };
}

export function createGroundingSearchDouble(hits: readonly SearchHit[]): GroundingSearch {
  return {
    async search(): Promise<SearchHit[]> {
      return hits.map((hit) => ({ ...hit }));
    },
  };
}

function hitsFromBody(body: unknown): SearchHit[] {
  if (!isRecord(body) || !Array.isArray(body.results)) return [];
  const hits: SearchHit[] = [];
  for (const row of body.results) {
    if (!isRecord(row) || typeof row.url !== "string" || typeof row.title !== "string") continue;
    if (row.url.length === 0 || row.title.length === 0) continue;
    const hit: SearchHit = { url: row.url, title: row.title };
    const raw = rawText(row);
    if (raw !== undefined) hit.rawContent = raw;
    hits.push(hit);
  }
  return hits;
}

function rawText(row: Record<string, unknown>): string | undefined {
  if (typeof row.raw_content === "string" && row.raw_content.length > 0) return row.raw_content;
  if (typeof row.content === "string" && row.content.length > 0) return row.content;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
