import { DEFAULT_SCOUT_CONFIG } from "@wayfare/domain";
import { vi } from "vitest";
import {
  createGroundingSearchDouble,
  createTavilySearch,
  type GroundingSearch,
  runPacketSearch,
  SearchError,
  type SearchHit,
  type SearchProvider,
} from "./tavily";

const apiKey = "unit-test-search-key";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test("Tavily posts raw content and max_results with the key only in Authorization", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(requestUrl(input)).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${apiKey}`);
    const raw = String(init?.body);
    expect(raw).not.toContain(apiKey);
    const body = JSON.parse(raw) as {
      include_raw_content: boolean;
      max_results: number;
      search_depth: string;
      query: string;
    };
    expect(body.include_raw_content).toBe(true);
    expect(body.max_results).toBe(DEFAULT_SCOUT_CONFIG.searchMaxResults);
    expect(body.search_depth).toBe("advanced");
    expect(body.query).toBe("best gelato Florence");
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Gelato",
            url: "https://example.com/gelato",
            raw_content: "pistachio sorbet",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  const search = createTavilySearch(apiKey, fetchImpl as typeof fetch, DEFAULT_SCOUT_CONFIG);
  const hits = await search.search("best gelato Florence");
  expect(hits).toEqual([
    { url: "https://example.com/gelato", title: "Gelato", rawContent: "pistachio sorbet" },
  ]);
  expect(JSON.stringify(hits)).not.toContain(apiKey);
});

test("a non-200 Tavily response skips the packet and records an error without the key", async () => {
  const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
  const search = createTavilySearch(apiKey, fetchImpl as typeof fetch, DEFAULT_SCOUT_CONFIG);
  const errors: string[] = [];
  const skipped = await runPacketSearch(search, ["gelato florence", "second query"], errors);
  expect(skipped).toEqual({ skipped: "search" });
  expect(errors).toEqual(["tavily status 503"]);
  expect(JSON.stringify(errors)).not.toContain(apiKey);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await expect(search.search("gelato florence")).rejects.toBeInstanceOf(SearchError);
});

test("runPacketSearch concatenates hits from each query", async () => {
  const provider: SearchProvider = {
    async search(query: string) {
      return [{ url: `https://example.com/${query}`, title: query }];
    },
  };
  const errors: string[] = [];
  const result = await runPacketSearch(provider, ["alpha", "beta"], errors);
  expect(errors).toEqual([]);
  expect(result).toEqual({
    hits: [
      { url: "https://example.com/alpha", title: "alpha" },
      { url: "https://example.com/beta", title: "beta" },
    ],
  });
});

test("GroundingSearch double matches SearchProvider and returns its hits", async () => {
  const hits: SearchHit[] = [{ url: "https://example.com/a", title: "A", rawContent: "body" }];
  const grounding: GroundingSearch = createGroundingSearchDouble(hits);
  const provider: SearchProvider = grounding;
  await expect(provider.search("anything")).resolves.toEqual(hits);
});
