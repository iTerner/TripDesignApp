import type { AreasResponse, EnrichResponse, StaysResponse, TrendsResponse } from "@wayfare/domain";
import type { IntelligenceBackend } from "./types";

export function createFakeBackend(answers: Record<string, unknown>): IntelligenceBackend {
  const take = <T>(key: string): T => {
    if (!Object.hasOwn(answers, key)) throw new Error(`fake backend has no answer for ${key}`);
    return answers[key] as T;
  };
  return {
    id: "fake",
    listAreas: async () => take<AreasResponse>("areas"),
    extractTrends: async () => take<TrendsResponse>("trends"),
    enrichBatch: async () => take<EnrichResponse>("enrich"),
    suggestStays: async () => take<StaysResponse>("stays"),
  };
}
