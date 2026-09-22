import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SCOUT_CONFIG, type ScoutConfig } from "@wayfare/domain";
import { vi } from "vitest";
import { clearFetchCache, fetchPage, quoteVerified } from "./fetchPage";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const robotsTxt = readFileSync(join(fixtures, "robots.txt"), "utf8");
const sorbettiera = readFileSync(join(fixtures, "pages", "sorbettiera.html"), "utf8");

const lookup = async () => ["8.8.8.8"];

function cfg(maxBytes = DEFAULT_SCOUT_CONFIG.fetch.maxBytes): ScoutConfig {
  return { ...DEFAULT_SCOUT_CONFIG, fetch: { ...DEFAULT_SCOUT_CONFIG.fetch, maxBytes } };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(() => {
  clearFetchCache();
});

test("quoteVerified matches case and collapsed whitespace, and rejects a missing quote", () => {
  expect(quoteVerified("hello world", "Hello   world!")).toBe(true);
  expect(quoteVerified("not on the page", "Hello world")).toBe(false);
  expect(quoteVerified("   ", "Hello world")).toBe(false);
  expect(quoteVerified("don't miss the pistachio", "Don\u2019t miss the pistachio")).toBe(true);
});

test("quoteVerified rejects quotes longer than 240 characters", () => {
  expect(quoteVerified("a".repeat(241), "a".repeat(241))).toBe(false);
  expect(quoteVerified("a".repeat(240), "a".repeat(240))).toBe(true);
});

test("loopback is skipped as ssrf without calling fetch", async () => {
  const fetchImpl = vi.fn();
  const result = await fetchPage("http://127.0.0.1/", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(),
  });
  expect(result).toEqual({ skipped: "ssrf" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("a hostname that resolves to a private address is skipped as ssrf", async () => {
  const fetchImpl = vi.fn();
  const result = await fetchPage("https://example.com/place", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(),
    lookup: async () => ["8.8.8.8", "10.1.1.1"],
  });
  expect(result).toEqual({ skipped: "ssrf" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("a 3-byte body over maxBytes 2 is skipped as too-large", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    if (requestUrl(input).endsWith("/robots.txt")) return new Response(null, { status: 404 });
    return new Response("abc", { status: 200, headers: { "content-type": "text/plain" } });
  });
  const result = await fetchPage("https://example.com/place", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(2),
    lookup,
  });
  expect(result).toEqual({ skipped: "too-large" });
});

test("noai and noindex meta pages are discovery-only", async () => {
  const noai = await fetchPage("https://example.com/noai", {
    fetchImpl: htmlFetch(
      `<html><head><meta name="robots" content="noai"></head><body><p>Hidden gelato</p></body></html>`,
    ) as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(noai).toEqual({ text: expect.stringContaining("Hidden gelato"), quoteAllowed: false });

  clearFetchCache();
  const noindex = await fetchPage("https://example.com/noindex", {
    fetchImpl: htmlFetch(
      `<html><head><meta name="robots" content="noindex, nofollow"></head><body><p>Index me not</p></body></html>`,
    ) as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(noindex).toEqual({ text: expect.stringContaining("Index me not"), quoteAllowed: false });
});

test("a normal page returns paragraph text and sends the configured user agent", async () => {
  const html = "<html><body><script>secretToken</script><p>Hello there</p></body></html>";
  const seen: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get("user-agent") ?? "");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (requestUrl(input).endsWith("/robots.txt")) return new Response(null, { status: 404 });
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
  const result = await fetchPage("https://example.com/place", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(result).toEqual({ text: expect.stringContaining("Hello there"), quoteAllowed: true });
  if ("text" in result) expect(result.text).not.toContain("secretToken");
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((ua) => ua === DEFAULT_SCOUT_CONFIG.fetch.userAgent)).toBe(true);
});

test("robots.txt Disallow /private skips the page fetch", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.endsWith("/robots.txt")) {
      return new Response(robotsTxt, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("<p>should not fetch</p>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });
  const result = await fetchPage("https://example.com/private/x", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(result).toEqual({ skipped: "robots" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const first = fetchImpl.mock.calls[0]?.[0];
  expect(first).toBeDefined();
  if (first) expect(requestUrl(first)).toBe("https://example.com/robots.txt");
});

test("a redirect to loopback is skipped as ssrf", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("127.0.0.1")) throw new Error("fetched loopback");
    if (url.endsWith("/robots.txt")) return new Response(null, { status: 404 });
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } });
  });
  const result = await fetchPage("https://example.com/place", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(result).toEqual({ skipped: "ssrf" });
});

test("non-html bodies are skipped", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    if (requestUrl(input).endsWith("/robots.txt")) return new Response(null, { status: 404 });
    return new Response("not html", { status: 200, headers: { "content-type": "image/jpeg" } });
  });
  const result = await fetchPage("https://example.com/photo", {
    fetchImpl: fetchImpl as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(result).toEqual({ skipped: "content-type" });
});

test("the sorbettiera fixture quote verifies against extracted text", async () => {
  const result = await fetchPage("https://example.com/florence-gelato-2026", {
    fetchImpl: htmlFetch(sorbettiera) as typeof fetch,
    cfg: cfg(),
    lookup,
  });
  expect(result).toMatchObject({ quoteAllowed: true });
  if ("text" in result) {
    expect(quoteVerified("went viral on TikTok this spring", result.text)).toBe(true);
  }
});

function htmlFetch(html: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (requestUrl(input).endsWith("/robots.txt")) return new Response(null, { status: 404 });
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}
