import { GeminiProvider } from "./gemini";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

test("sends key in header, model in path, schema in generationConfig; returns text", async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  const r = await new GeminiProvider("KEY", f.fn).complete("gemini-3.8-flash", {
    prompt: "hi",
    jsonSchema: { type: "object" },
  });
  expect(r).toEqual({ text: '{"ok":true}', modelId: "gemini-3.8-flash", provider: "google" });
  expect(f.calls[0]?.url).toContain("/models/gemini-3.8-flash:generateContent");
  expect(new Headers(f.calls[0]?.init?.headers).get("x-goog-api-key")).toBe("KEY");
  const sent = JSON.parse(String(f.calls[0]?.init?.body));
  expect(sent.generationConfig.responseMimeType).toBe("application/json");
  expect(sent.generationConfig.responseSchema).toEqual({ type: "object" });
});

test("system prompt goes to systemInstruction", async () => {
  const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: "x" }] } }] });
  await new GeminiProvider("KEY", f.fn).complete("m", { prompt: "p", system: "s" });
  expect(JSON.parse(String(f.calls[0]?.init?.body)).systemInstruction).toEqual({
    parts: [{ text: "s" }],
  });
});

test("429 daily quota → LlmError daily_quota", async () => {
  const f = fakeFetch(429, { error: { message: "limit: 20 per day" } });
  await expect(
    new GeminiProvider("KEY", f.fn).complete("m", { prompt: "hi" }),
  ).rejects.toMatchObject({ kind: "daily_quota" });
});

test("empty candidates → LlmError other", async () => {
  const f = fakeFetch(200, { candidates: [] });
  await expect(
    new GeminiProvider("KEY", f.fn).complete("m", { prompt: "x" }),
  ).rejects.toMatchObject({ kind: "other" });
});
