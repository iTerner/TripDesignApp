import { env } from "cloudflare:test";
import { createApp } from "../src/app";

test("the 61st request from one IP within a minute gets 429 rate_limited; another IP is unaffected", async () => {
  const app = createApp({ now: () => new Date("2026-09-20T12:00:00Z") });
  const from = (ip: string) => app.request("/health", { headers: { "cf-connecting-ip": ip } }, env);
  for (let i = 0; i < 60; i += 1) expect((await from("203.0.113.7")).status).toBe(200);
  const blocked = await from("203.0.113.7");
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toMatchObject({ error: "rate_limited" });
  expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  expect((await from("203.0.113.8")).status).toBe(200);
});

test("the bucket refills after the window", async () => {
  let t = Date.parse("2026-09-20T12:00:00Z");
  const app = createApp({ now: () => new Date(t) });
  const from = () =>
    app.request("/health", { headers: { "cf-connecting-ip": "203.0.113.9" } }, env);
  for (let i = 0; i < 60; i += 1) await from();
  expect((await from()).status).toBe(429);
  t += 61_000;
  expect((await from()).status).toBe(200);
});
