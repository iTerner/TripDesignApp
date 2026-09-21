import type { ModelEntry } from "@wayfare/domain";
import type { LlmErrorKind } from "./types";

export interface QuotaStore {
  isExhausted(modelEntryId: string, now: Date): Promise<boolean>;
  markExhausted(modelEntryId: string, untilIso: string): Promise<void>;
  recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void>;
}

export class InMemoryQuotaStore implements QuotaStore {
  readonly exhaustedUntil = new Map<string, string>();
  readonly calls: { id: string; outcome: string; at: string }[] = [];

  async isExhausted(id: string, now: Date): Promise<boolean> {
    const until = this.exhaustedUntil.get(id);
    return until !== undefined && new Date(until).getTime() > now.getTime();
  }

  async markExhausted(id: string, untilIso: string): Promise<void> {
    this.exhaustedUntil.set(id, untilIso);
  }

  async recordCall(entry: ModelEntry, outcome: "ok" | LlmErrorKind, now: Date): Promise<void> {
    this.calls.push({ id: entry.id, outcome, at: now.toISOString() });
  }
}
