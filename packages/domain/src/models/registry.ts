import { z } from "zod";
import registryJson from "./registry.json";

export const ProviderIdSchema = z.enum(["google", "openrouter"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const TaskTypeSchema = z.enum(["best", "extract", "search"]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const ModelEntrySchema = z.object({
  /** Stable internal id, e.g. "google:gemini-3.8-flash". */
  id: z.string().min(1),
  provider: ProviderIdSchema,
  /** Provider-specific model id sent on the wire. */
  modelId: z.string().min(1),
  enabled: z.boolean(),
  capabilities: z.object({ jsonSchema: z.boolean(), contextTokens: z.number().int().positive() }),
  /** Lower rank = tried earlier. Absent = not part of that chain. */
  rank: z.object({
    best: z.number().int().positive().optional(),
    extract: z.number().int().positive().optional(),
    search: z.number().int().positive().optional(),
  }),
  /** Learned daily request cap (spec §3.4). Unknown until the first daily 429. */
  observedRpd: z.number().int().positive().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelRegistrySchema = z.object({
  version: z.number().int().positive(),
  models: z.array(ModelEntrySchema).min(1),
});
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;

export function loadRegistry(json: unknown): ModelRegistry {
  const reg = ModelRegistrySchema.parse(json);
  const seen = new Set<string>();
  for (const m of reg.models) {
    if (seen.has(m.id)) throw new Error(`Model registry: duplicate id "${m.id}"`);
    seen.add(m.id);
  }
  return reg;
}

export function chainFor(registry: ModelRegistry, task: TaskType): ModelEntry[] {
  return registry.models
    .filter((m) => m.enabled && m.rank[task] !== undefined)
    .sort((a, b) => (a.rank[task] as number) - (b.rank[task] as number));
}

export const DEFAULT_REGISTRY: ModelRegistry = loadRegistry(registryJson);
