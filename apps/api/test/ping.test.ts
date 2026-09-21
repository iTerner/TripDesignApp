import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { fakeFirestore } from "./helpers/fakeFirestore";
import { TEST_SA_JSON } from "./helpers/testPem";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");
const withSa = { ...env, FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON };

test("first ping creates the user and bumps totals; second ping the same day changes nothing", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl: fs.fetchImpl });
  const token = await jwks.sign({ sub: "u1" });

  const first = await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${token}` } },
    withSa,
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, uid: "u1", firstSeen: true });
  expect(fs.docs.get("users/u1")).toMatchObject({
    tier: "free",
    tierSource: "none",
    freeGenerationUsed: false,
    plusRequested: false,
    lastActiveDate: "2026-09-20",
  });
  expect(fs.docs.get("metrics/global")).toEqual({ totalUsers: 1 });
  expect(fs.docs.get("metricsDaily/2026-09-20")).toEqual({ newUsers: 1, activeUsers: 1 });

  const second = await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${token}` } },
    withSa,
  );
  expect(await second.json()).toMatchObject({ firstSeen: false });
  expect(fs.docs.get("metricsDaily/2026-09-20")).toEqual({ newUsers: 1, activeUsers: 1 });
});

test("a ping on a new day counts one more active user", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  fs.docs.set("users/u2", { tier: "free", lastActiveDate: "2026-09-19" });
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl: fs.fetchImpl });
  const token = await jwks.sign({ sub: "u2" });
  const res = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, withSa);
  expect(await res.json()).toMatchObject({ firstSeen: false });
  expect(fs.docs.get("users/u2")).toMatchObject({ lastActiveDate: "2026-09-20" });
  expect(fs.docs.get("metricsDaily/2026-09-20")).toEqual({ activeUsers: 1 });
});

test("service-account token is cached in KV", async () => {
  const jwks = await makeTestJwks();
  const fs = fakeFirestore();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl: fs.fetchImpl });
  await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${await jwks.sign({ sub: "u3" })}` } },
    withSa,
  );
  expect(await env.CONFIG_KV.get("sa_access_token")).toBe("T");
});

test("FIRESTORE_EMULATOR_HOST routes REST calls to the emulator over http with the 'owner' token and no service account", async () => {
  const jwks = await makeTestJwks();
  const seen: { url: string; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response("{}", {
      status: url.includes(":commit") || init?.method === "PATCH" ? 200 : 404,
    });
  };
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const res = await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${await jwks.sign({ sub: "u4" })}` } },
    { ...env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_SERVICE_ACCOUNT: "" },
  );
  expect(res.status).toBe(200);
  expect(seen[0]?.url).toMatch(
    /^http:\/\/127\.0\.0\.1:8080\/v1\/projects\/test-project\/databases\/\(default\)\/documents\/users\/u4$/,
  );
  expect(seen.every((s) => s.auth === "Bearer owner")).toBe(true);
  expect(seen.some((s) => s.url.startsWith("https://oauth2.googleapis.com"))).toBe(false);
});
