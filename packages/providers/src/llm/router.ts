import {
  chainFor,
  type ModelEntry,
  type ModelRegistry,
  type ProviderId,
  type TaskType,
} from "@wayfare/domain";
import type { QuotaStore } from "./memoryQuotaStore";
import { nextResetIso } from "./reset";
import {
  LlmError,
  type LlmErrorKind,
  type LlmProvider,
  type LlmRequest,
  type LlmResult,
} from "./types";

export interface RouterAttempt {
  modelEntryId: string;
  modelId: string;
  outcome: "ok" | LlmErrorKind | "skipped_exhausted" | "skipped_no_provider";
}

export interface RouterResult extends LlmResult {
  modelEntryId: string;
  attempts: RouterAttempt[];
}

export interface ModelRouterOptions {
  registry: ModelRegistry;
  providers: Partial<Record<ProviderId, LlmProvider>>;
  quota: QuotaStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Retries of the same model on a per-minute 429 before moving on. */
  maxRateLimitRetry?: number;
}

const JSON_ONLY_SYSTEM =
  "Respond with JSON only. No prose, no markdown fences. The JSON must conform to this JSON Schema:\n";

export class ModelRouter {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRateLimitRetry: number;

  constructor(private readonly opts: ModelRouterOptions) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRateLimitRetry = opts.maxRateLimitRetry ?? 1;
  }

  async run(task: TaskType, req: LlmRequest): Promise<RouterResult> {
    const attempts: RouterAttempt[] = [];
    for (const entry of chainFor(this.opts.registry, task)) {
      const provider = this.opts.providers[entry.provider];
      if (!provider) {
        attempts.push({
          modelEntryId: entry.id,
          modelId: entry.modelId,
          outcome: "skipped_no_provider",
        });
        continue;
      }
      if (await this.opts.quota.isExhausted(entry.id, this.now())) {
        attempts.push({
          modelEntryId: entry.id,
          modelId: entry.modelId,
          outcome: "skipped_exhausted",
        });
        continue;
      }
      const effective = adaptRequest(entry, req);
      let rateLimitRetries = 0;
      for (;;) {
        try {
          const result = await provider.complete(entry.modelId, effective);
          await this.opts.quota.recordCall(entry, "ok", this.now());
          attempts.push({ modelEntryId: entry.id, modelId: entry.modelId, outcome: "ok" });
          return { ...result, modelEntryId: entry.id, attempts };
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError("other", String(err));
          await this.opts.quota.recordCall(entry, e.kind, this.now());
          if (e.kind === "rate_limit" && rateLimitRetries < this.maxRateLimitRetry) {
            rateLimitRetries += 1;
            await this.sleep(e.retryAfterMs ?? 5000);
            continue;
          }
          if (e.kind === "daily_quota") {
            await this.opts.quota.markExhausted(entry.id, nextResetIso(entry.provider, this.now()));
          }
          attempts.push({ modelEntryId: entry.id, modelId: entry.modelId, outcome: e.kind });
          break;
        }
      }
    }
    throw new LlmError(
      "daily_quota",
      `All models in chain "${task}" failed or are exhausted: ${attempts
        .map((a) => `${a.modelEntryId}=${a.outcome}`)
        .join(", ")}`,
    );
  }
}

/** Models without native JSON-schema output get the schema in the system prompt (spec §3.4). */
function adaptRequest(entry: ModelEntry, req: LlmRequest): LlmRequest {
  if (!req.jsonSchema || entry.capabilities.jsonSchema) return req;
  const { jsonSchema, ...rest } = req;
  const system = `${req.system ? `${req.system}\n\n` : ""}${JSON_ONLY_SYSTEM}${JSON.stringify(jsonSchema)}`;
  return { ...rest, system };
}
