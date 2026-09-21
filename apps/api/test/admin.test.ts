import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

async function setup() {
  const jwks = await makeTestJwks();
  return { jwks, app: createApp({ jwks: jwks.getKey, now: () => NOW }) };
}

test("non-admin uid → 403 forbidden", async () => {
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "someone-else", auth_time: nowSec - 10 });
  const res = await app.request(
    "/admin/ping",
    { headers: { authorization: `Bearer ${token}` } },
    env,
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "forbidden" });
});

test("admin uid → 200 with authAgeSec", async () => {
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "admin-uid-1", auth_time: nowSec - 120 });
  const res = await app.request(
    "/admin/ping",
    { headers: { authorization: `Bearer ${token}` } },
    env,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, uid: "admin-uid-1", authAgeSec: 120 });
});

test("GET with stale auth is fine; POST with stale auth → 401 reauth_required; fresh POST → 200", async () => {
  const { jwks, app } = await setup();
  const stale = await jwks.sign({ sub: "admin-uid-2", auth_time: nowSec - 16 * 60 });
  expect(
    (await app.request("/admin/ping", { headers: { authorization: `Bearer ${stale}` } }, env))
      .status,
  ).toBe(200);
  const post = await app.request(
    "/admin/echo",
    {
      method: "POST",
      headers: { authorization: `Bearer ${stale}`, "content-type": "application/json" },
      body: "{}",
    },
    env,
  );
  expect(post.status).toBe(401);
  expect(await post.json()).toMatchObject({ error: "reauth_required" });
  const fresh = await jwks.sign({ sub: "admin-uid-2", auth_time: nowSec - 14 * 60 });
  expect(
    (
      await app.request(
        "/admin/echo",
        {
          method: "POST",
          headers: { authorization: `Bearer ${fresh}`, "content-type": "application/json" },
          body: "{}",
        },
        env,
      )
    ).status,
  ).toBe(200);
});

test("admin routes still require a valid token", async () => {
  const { app } = await setup();
  expect((await app.request("/admin/ping", {}, env)).status).toBe(401);
});

test("non-admin gets 403 on EVERY /admin/* route, including unknown ones (guard runs before routing)", async () => {
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "someone-else", auth_time: nowSec - 10 });
  for (const [method, path] of [
    ["GET", "/admin/ping"],
    ["POST", "/admin/echo"],
    ["POST", "/admin/llm/ping"],
    ["GET", "/admin/does-not-exist"],
    ["DELETE", "/admin/users/x"],
  ] as const) {
    const res = await app.request(
      path,
      { method, headers: { authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status, `${method} ${path}`).toBe(403);
  }
});

test("ADMIN_UIDS parsing ignores whitespace and empty entries; an empty secret grants nobody", async () => {
  const { parseAdminUids } = await import("../src/auth/admin");
  expect([...parseAdminUids(" a , b ,, c ,")]).toEqual(["a", "b", "c"]);
  expect(parseAdminUids("").size).toBe(0);
  expect(parseAdminUids(" , ").size).toBe(0);
  const { jwks, app } = await setup();
  const token = await jwks.sign({ sub: "admin-uid-1", auth_time: nowSec - 10 });
  const res = await app.request(
    "/admin/ping",
    { headers: { authorization: `Bearer ${token}` } },
    { ...env, ADMIN_UIDS: "" },
  );
  expect(res.status).toBe(403);
});
