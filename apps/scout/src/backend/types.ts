import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AreasRequest,
  AreasResponse,
  EnrichRequest,
  EnrichResponse,
  PacketType,
  RejectionReason,
  ScoutConfig,
  StaysRequest,
  StaysResponse,
  TrendsRequest,
  TrendsResponse,
} from "@wayfare/domain";

/** Structural match for Task 7 `SearchHit` / `SearchProvider` (Tavily is that search). */
export interface SearchHit {
  url: string;
  title: string;
  rawContent?: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchHit[]>;
}

/** Structural match for Task 7 `fetchPage` so the real function can be passed in. */
export type FetchPageFn = (
  url: string,
  opts: { fetchImpl: typeof fetch; cfg: ScoutConfig },
) => Promise<{ text: string; quoteAllowed: boolean } | { skipped: string }>;

export interface IntelligenceBackend {
  readonly id: "fake" | "gemini" | "agent";
  listAreas(req: AreasRequest): Promise<AreasResponse>;
  extractTrends(
    req: TrendsRequest,
    pages: { url: string; text: string }[],
  ): Promise<TrendsResponse>;
  enrichBatch(req: EnrichRequest): Promise<EnrichResponse>;
  suggestStays(req: StaysRequest): Promise<StaysResponse>;
}

export class BudgetExceeded extends Error {
  constructor(readonly kind: "llm" | "searches") {
    super(`budget exceeded (${kind})`);
    this.name = "BudgetExceeded";
  }
}

export class AwaitingPackets extends Error {
  constructor(readonly packetId: string) {
    super(`awaiting packet ${packetId}`);
    this.name = "AwaitingPackets";
  }
}

export class PacketValidationError extends Error {
  readonly reasons: RejectionReason[];
  constructor(
    readonly packetId: string,
    reasons: RejectionReason[],
  ) {
    super(reasons.map((r) => `${r.path}: ${r.reason}`).join("\n"));
    this.name = "PacketValidationError";
    this.reasons = reasons;
  }
}

export class RejectionsExceeded extends Error {
  readonly reasons: RejectionReason[];
  constructor(
    readonly packetId: string,
    reasons: RejectionReason[],
  ) {
    super(`rejections exceeded for ${packetId}`);
    this.name = "RejectionsExceeded";
    this.reasons = reasons;
  }
}

export class PathRefused extends Error {
  constructor(readonly responsePath: string) {
    super(`refused: response path "${responsePath}"`);
    this.name = "PathRefused";
  }
}

const promptCache = new Map<PacketType, string>();

export function readScoutPrompt(type: PacketType): string {
  const cached = promptCache.get(type);
  if (cached !== undefined) return cached;
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "packages",
    "domain",
    "prompts",
    "scout",
    `${type}.md`,
  );
  const text = readFileSync(path, "utf8");
  promptCache.set(type, text);
  return text;
}
