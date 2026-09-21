import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { fakeFirestore } from "./helpers/fakeFirestore";
import { TEST_SA_JSON } from "./helpers/testPem";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");

test("admin llm ping falls back from an exhausted Gemini model to the next and reports attempts", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  let geminiCalls = 0;
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      if (url.includes("gemini-3.8-flash"))
        return new Response(JSON.stringify({ error: { message: "limit 20 per day" } }), {
          status: 429,
        });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
        { status: 200 },
      );
    }
    return fs.fetchImpl(url, init);
  };
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const token = await jwks.sign({
    sub: "admin-uid-1",
    auth_time: Math.floor(NOW.getTime() / 1000) - 30,
  });
  const res = await app.request(
    "/admin/llm/ping",
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
    { ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON },
  );
  expect(res.status).toBe(200);
  const body = await res.json<{
    modelUsed: string;
    attempts: { modelId: string; outcome: string }[];
  }>();
  expect(body.modelUsed).toBe("gemini-3.7-flash");
  expect(body.attempts.map((a) => a.outcome)).toEqual(["daily_quota", "ok"]);
  expect(geminiCalls).toBe(2);
  expect(fs.docs.get("usageDaily/google_2026-09-20")).toMatchObject({ total: 2 });
  expect(await env.CONFIG_KV.get("exhausted:google:gemini-3.8-flash")).toBe(
    "2026-09-21T07:00:00.000Z",
  );
});

test("when every model fails the route answers 503 upstream_exhausted", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  const fetchImpl = async (url: string, init?: RequestInit) =>
    url.includes("generativelanguage") || url.includes("openrouter.ai")
      ? new Response(JSON.stringify({ error: { message: "per day" } }), { status: 429 })
      : fs.fetchImpl(url, init);
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const token = await jwks.sign({
    sub: "admin-uid-1",
    auth_time: Math.floor(NOW.getTime() / 1000) - 30,
  });
  const res = await app.request(
    "/admin/llm/ping",
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
    { ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON },
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: "upstream_exhausted" });
});
