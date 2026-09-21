import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");

test("no token → 401 unauthorized", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const res = await app.request("/ping", {}, env);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("valid token → 200 with uid and serverTime", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const token = await jwks.sign({ sub: "abc123" });
  const res = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    uid: "abc123",
    serverTime: NOW.toISOString(),
  });
});

test.each([
  [
    "wrong audience",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.sign({ aud: "other-project" }),
  ],
  [
    "wrong issuer",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) =>
      j.sign({ iss: "https://securetoken.google.com/other" }),
  ],
  ["foreign signing key", (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.signWithForeignKey()],
  [
    "expired",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) =>
      j.sign({ exp: Math.floor(NOW.getTime() / 1000) - 10 }),
  ],
  ["alg none (unsecured)", (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.unsecured()],
  [
    "alg HS256 (algorithm confusion)",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.signHs256(),
  ],
  ["missing sub", (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.sign({ sub: undefined })],
  ["empty sub", (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.sign({ sub: "" })],
  [
    "email_verified false",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.sign({ email_verified: false }),
  ],
  [
    "email_verified absent",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) => j.sign({ email_verified: undefined }),
  ],
  [
    "auth_time in the future",
    (j: Awaited<ReturnType<typeof makeTestJwks>>) =>
      j.sign({ auth_time: Math.floor(NOW.getTime() / 1000) + 3600 }),
  ],
] as const)("rejects a token with %s → 401", async (_label, make) => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const token = await make(jwks);
  const res = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: "unauthorized" });
});

test("malformed Authorization headers → 401 (no scheme, wrong scheme, garbage token)", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  for (const authorization of ["", "Basic abc", "Bearer", "Bearer not.a.jwt", "Token x.y.z"]) {
    const res = await app.request(
      "/ping",
      { headers: authorization ? { authorization } : {} },
      env,
    );
    expect(res.status, authorization).toBe(401);
  }
});

test("emulator mode: unsigned Auth-emulator tokens are accepted ONLY when FIREBASE_AUTH_EMULATOR_HOST is set", async () => {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW });
  const token = await jwks.unsecured({ sub: "emu-user" });
  const prod = await app.request("/ping", { headers: { authorization: `Bearer ${token}` } }, env);
  expect(prod.status).toBe(401);
  const dev = await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${token}` } },
    { ...env, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
  );
  expect(dev.status).toBe(200);
  expect(await dev.json()).toMatchObject({ uid: "emu-user" });
  // even in emulator mode, iss/aud/exp/email_verified still apply
  const badAud = await app.request(
    "/ping",
    { headers: { authorization: `Bearer ${await jwks.unsecured({ aud: "other" })}` } },
    { ...env, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
  );
  expect(badAud.status).toBe(401);
});
