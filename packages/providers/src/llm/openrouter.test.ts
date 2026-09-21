import { OpenRouterProvider } from "./openrouter";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fn: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

test("OpenAI-compatible request with bearer key, referer and json_schema response_format", async () => {
  const f = fakeFetch(200, {
    choices: [{ message: { content: '{"ok":true}' } }],
    model: "qwen/qwen3.8-27b:free",
  });
  const r = await new OpenRouterProvider("KEY", f.fn, "https://app.test").complete(
    "qwen/qwen3.8-27b:free",
    { prompt: "hi", system: "sys", jsonSchema: { type: "object" } },
  );
  expect(r.text).toBe('{"ok":true}');
  expect(r.modelId).toBe("qwen/qwen3.8-27b:free");
  expect(f.calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  const h = new Headers(f.calls[0]?.init?.headers);
  expect(h.get("authorization")).toBe("Bearer KEY");
  expect(h.get("http-referer")).toBe("https://app.test");
  expect(h.get("x-title")).toBe("app.test");
  const sent = JSON.parse(String(f.calls[0]?.init?.body));
  expect(sent.messages[0]).toEqual({ role: "system", content: "sys" });
  expect(sent.response_format.type).toBe("json_schema");
});

test("without a referer no attribution headers are sent", async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: "ok" } }] });
  await new OpenRouterProvider("KEY", f.fn).complete("m", { prompt: "x" });
  const h = new Headers(f.calls[0]?.init?.headers);
  expect(h.get("authorization")).toBe("Bearer KEY");
  expect(h.has("http-referer")).toBe(false);
  expect(h.has("x-title")).toBe(false);
});

test("daily free limit 429 → daily_quota", async () => {
  const f = fakeFetch(429, { error: { message: "free-models-per-day limit reached" } });
  await expect(
    new OpenRouterProvider("KEY", f.fn).complete("openrouter/free", { prompt: "x" }),
  ).rejects.toMatchObject({ kind: "daily_quota" });
});

test("null content → LlmError other", async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: null } }] });
  await expect(
    new OpenRouterProvider("KEY", f.fn).complete("m", { prompt: "x" }),
  ).rejects.toMatchObject({ kind: "other" });
});
