import { chainFor, DEFAULT_REGISTRY, loadRegistry } from "./registry";

const entry = (
  id: string,
  provider: "google" | "openrouter",
  rank: Record<string, number>,
  enabled = true,
) => ({
  id,
  provider,
  modelId: id,
  enabled,
  capabilities: { jsonSchema: true, contextTokens: 1000 },
  rank,
});

test("default registry: best chain starts with gemini-3.8-flash and ends with openrouter/free", () => {
  const chain = chainFor(DEFAULT_REGISTRY, "best");
  expect(chain.length).toBeGreaterThan(5);
  expect(chain[0]?.modelId).toBe("gemini-3.8-flash");
  expect(chain.at(-1)?.modelId).toBe("openrouter/free");
});

test("extract chain starts with gemini-3.5-flash-lite; search chain starts with gemini-2.5-flash-lite", () => {
  expect(chainFor(DEFAULT_REGISTRY, "extract")[0]?.modelId).toBe("gemini-3.5-flash-lite");
  expect(chainFor(DEFAULT_REGISTRY, "search")[0]?.modelId).toBe("gemini-2.5-flash-lite");
});

test("disabled models are skipped", () => {
  const reg = loadRegistry({
    version: 1,
    models: [entry("a", "google", { best: 1 }, false), entry("b", "google", { best: 2 })],
  });
  expect(chainFor(reg, "best").map((m) => m.id)).toEqual(["b"]);
});

test("duplicate ids are rejected", () => {
  expect(() =>
    loadRegistry({
      version: 1,
      models: [entry("a", "google", { best: 1 }), entry("a", "google", { best: 2 })],
    }),
  ).toThrow(/duplicate/i);
});

test("a chain is sorted by rank even if the file is not", () => {
  const reg = loadRegistry({
    version: 1,
    models: [entry("z", "openrouter", { best: 9 }), entry("y", "google", { best: 1 })],
  });
  expect(chainFor(reg, "best").map((m) => m.id)).toEqual(["y", "z"]);
});
