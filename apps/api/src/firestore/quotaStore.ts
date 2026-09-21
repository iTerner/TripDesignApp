import type { ModelEntry } from "@wayfare/domain";
import { type LlmErrorKind, providerDayKey, type QuotaStore } from "@wayfare/providers";
import type { FirestoreClient } from "./client";

/** Exhaustion flags in KV (rare writes); per-call counters in Firestore (spec §2.3 KV write ceiling). */
export class FirestoreQuotaStore implements QuotaStore {
  constructor(private readonly opts: { db: FirestoreClient; kv: KVNamespace }) {}

  async isExhausted(modelEntryId: string, now: Date): Promise<boolean> {
    const until = await this.opts.kv.get(`exhausted:${modelEntryId}`);
    return until !== null && new Date(until).getTime() > now.getTime();
  }

  async markExhausted(modelEntryId: string, untilIso: string): Promise<void> {
    const ttl = Math.max(60, Math.floor((new Date(untilIso).getTime() - Date.now()) / 1000));
    await this.opts.kv.put(`exhausted:${modelEntryId}`, untilIso, { expirationTtl: ttl });
  }

  async recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void> {
    const day = providerDayKey(entry.provider, now);
    await this.opts.db.incrementFields(`usageDaily/${entry.provider}_${day}`, {
      [`${entry.id}.${outcome}`]: 1,
      total: 1,
    });
  }
}
