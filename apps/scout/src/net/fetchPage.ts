import type { ScoutConfig } from "@wayfare/domain";
import { assertPublicUrl } from "./ssrf";

const QUOTE_MAX_CHARS = 240;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

export type HostLookup = (host: string) => Promise<string[]>;

export interface FetchPageOptions {
  fetchImpl: typeof fetch;
  cfg: ScoutConfig;
  lookup?: HostLookup;
}

export type FetchPageResult = { text: string; quoteAllowed: boolean } | { skipped: string };

type Skipped = { skipped: string };
type Rule = { allow: boolean; path: string };
type Group = { agent: string; rules: Rule[] };
type RobotsDecision = (path: string) => boolean;

const robotsCache = new Map<string, RobotsDecision>();

export function clearFetchCache(): void {
  robotsCache.clear();
}

/** True when `quote` is at most 240 characters and occurs in `pageText`. */
export function quoteVerified(quote: string, pageText: string): boolean {
  const trimmed = quote.trim();
  if (trimmed.length === 0 || trimmed.length > QUOTE_MAX_CHARS) return false;
  const needle = normalizeForQuote(quote);
  if (needle.length === 0) return false;
  return normalizeForQuote(pageText).includes(needle);
}

/**
 * Fetch one public HTML or text page.
 * Order: SSRF check, robots.txt (cached per origin), then GET with a body cap of maxBytes.
 * `noai` / `noindex` pages still return text, with `quoteAllowed: false`.
 */
export async function fetchPage(url: string, opts: FetchPageOptions): Promise<FetchPageResult> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    const parsed = parseHttpUrl(current);
    if (!parsed) return { skipped: "ssrf" };
    try {
      await assertPublic(current, opts.lookup);
    } catch {
      return { skipped: "ssrf" };
    }

    const decision = await robotsFor(parsed.origin, opts);
    if ("skipped" in decision) return decision;
    if (!decision.allowed(parsed.pathname)) return { skipped: "robots" };

    const res = await request(current, opts);
    if ("skipped" in res) return res;
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      await cancelBody(res);
      if (!location) return { skipped: "http" };
      current = new URL(location, current).href;
      continue;
    }
    if (!res.ok) {
      await cancelBody(res);
      return { skipped: "http" };
    }
    const bytes = await readCapped(res, opts.cfg.fetch.maxBytes);
    if (bytes === "too-large") return { skipped: "too-large" };
    return interpret(res, bytes);
  }
  return { skipped: "redirects" };
}

function normalizeForQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function assertPublic(url: string, lookup: HostLookup | undefined): Promise<void> {
  if (lookup) await assertPublicUrl(url, lookup);
  else await assertPublicUrl(url);
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function robotsFor(
  origin: string,
  opts: FetchPageOptions,
): Promise<{ allowed: RobotsDecision } | Skipped> {
  const cached = robotsCache.get(origin);
  if (cached) return { allowed: cached };

  let current = new URL("/robots.txt", origin).href;
  for (let hop = 0; hop < 5; hop += 1) {
    try {
      await assertPublic(current, opts.lookup);
    } catch {
      return { skipped: "ssrf" };
    }
    const res = await request(current, opts);
    if ("skipped" in res) return res;
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      await cancelBody(res);
      if (!location) return { skipped: "robots" };
      current = new URL(location, current).href;
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      await cancelBody(res);
      const allowAll = () => true;
      robotsCache.set(origin, allowAll);
      return { allowed: allowAll };
    }
    if (!res.ok) {
      await cancelBody(res);
      return { skipped: "robots" };
    }
    const bytes = await readCapped(res, opts.cfg.fetch.maxBytes);
    if (bytes === "too-large") return { skipped: "too-large" };
    const allowed = compileRobots(new TextDecoder().decode(bytes), opts.cfg.fetch.userAgent);
    robotsCache.set(origin, allowed);
    return { allowed };
  }
  return { skipped: "redirects" };
}

async function request(url: string, opts: FetchPageOptions): Promise<Response | Skipped> {
  try {
    return await opts.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": opts.cfg.fetch.userAgent,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      signal: AbortSignal.timeout(opts.cfg.fetch.timeoutMs),
    });
  } catch (err) {
    return { skipped: isTimeout(err) ? "timeout" : "fetch" };
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | "too-large"> {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      await cancelBody(res);
      return "too-large";
    }
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? "too-large" : buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cap = maxBytes + 1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    if (total + value.byteLength > cap) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(value);
    total += value.byteLength;
  }
  if (total > maxBytes) return "too-large";
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function interpret(res: Response, bytes: Uint8Array): FetchPageResult {
  const type = mediaType(res);
  const decoded = new TextDecoder().decode(bytes);
  if (type === "text/plain") {
    return { text: collapse(decoded), quoteAllowed: quotesAllowed(res.headers, "") };
  }
  if ((type !== null && HTML_TYPES.has(type)) || (type === null && looksLikeHtml(decoded))) {
    return {
      text: htmlToText(decoded),
      quoteAllowed: quotesAllowed(res.headers, decoded),
    };
  }
  if (type === null) {
    return { text: collapse(decoded), quoteAllowed: quotesAllowed(res.headers, "") };
  }
  return { skipped: "content-type" };
}

function mediaType(res: Response): string | null {
  const raw = res.headers.get("content-type");
  if (!raw) return null;
  const type = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.length > 0 ? type : null;
}

function looksLikeHtml(text: string): boolean {
  return /<\s*(html|body|p|article|div|meta)\b/i.test(text);
}

function quotesAllowed(headers: Headers, html: string): boolean {
  const header = headers.get("x-robots-tag");
  if (header && blocksQuotes(header)) return false;
  return !metaBlocksQuotes(html);
}

function blocksQuotes(value: string): boolean {
  const tokens = value
    .toLowerCase()
    .split(/[\s,;:]+/)
    .filter((token) => token.length > 0);
  return tokens.includes("noai") || tokens.includes("noindex") || tokens.includes("none");
}

function metaBlocksQuotes(html: string): boolean {
  for (const meta of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = meta[1] ?? "";
    const name = attr(attrs, "name");
    const content = attr(attrs, "content");
    if (!name || !content) continue;
    const normalized = name.toLowerCase();
    if (normalized !== "robots" && normalized !== "googlebot") continue;
    if (blocksQuotes(content)) return true;
  }
  return false;
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i");
  const match = re.exec(attrs);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function htmlToText(html: string): string {
  const source = mainHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return collapse(decodeEntities(source));
}

function mainHtml(html: string): string {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (article?.[1]) return article[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (body?.[1]) return body[1];
  return html;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (raw, hex: string) => fromCode(Number.parseInt(hex, 16), raw))
    .replace(/&#(\d+);/g, (raw, dec: string) => fromCode(Number(dec), raw))
    .replace(/&amp;/gi, "&");
}

function fromCode(code: number, raw: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return raw;
  return String.fromCodePoint(code);
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compileRobots(body: string, userAgent: string): RobotsDecision {
  const rules = rulesForAgent(parseRobots(body), userAgent);
  return (path: string) => pathAllowed(path, rules);
}

function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let agents: string[] = [];
  let rules: Rule[] = [];
  const flush = () => {
    if (agents.length > 0) {
      const copy = [...rules];
      for (const agent of agents) groups.push({ agent, rules: copy });
    }
    agents = [];
    rules = [];
  };
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const uncommented = raw.replace(/#.*$/, "");
    if (uncommented.trim().length === 0) {
      if (raw.trim().length === 0) flush();
      continue;
    }
    const sep = uncommented.indexOf(":");
    if (sep < 0) continue;
    const key = uncommented.slice(0, sep).trim().toLowerCase();
    const value = uncommented.slice(sep + 1).trim();
    if (key === "user-agent") {
      if (rules.length > 0) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if ((key === "allow" || key === "disallow") && agents.length > 0 && value.length > 0) {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  flush();
  return groups;
}

function rulesForAgent(groups: Group[], userAgent: string): Rule[] {
  const haystack = userAgent.toLowerCase();
  let best = -1;
  let chosen: Rule[] = [];
  for (const group of groups) {
    const score =
      group.agent === "*" ? 0 : haystack.includes(group.agent) ? group.agent.length : -1;
    if (score < 0 || score < best) continue;
    if (score > best) {
      best = score;
      chosen = [...group.rules];
    } else {
      chosen = [...chosen, ...group.rules];
    }
  }
  return chosen;
}

function pathAllowed(path: string, rules: Rule[]): boolean {
  let winner: { length: number; allow: boolean } | null = null;
  for (const rule of rules) {
    if (!matchesRule(rule.path, path)) continue;
    const length = rule.path.length;
    if (
      winner === null ||
      length > winner.length ||
      (length === winner.length && rule.allow && !winner.allow)
    ) {
      winner = { length, allow: rule.allow };
    }
  }
  return winner?.allow ?? true;
}

function matchesRule(pattern: string, path: string): boolean {
  let anchored = false;
  let source = pattern;
  if (source.endsWith("$")) {
    anchored = true;
    source = source.slice(0, -1);
  }
  const body = source.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function cancelBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}
