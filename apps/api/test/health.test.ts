import { env } from "cloudflare:test";
import { createApp } from "../src/app";

const app = createApp();

const SECURITY_HEADERS: Record<string, string | RegExp> = {
  "strict-transport-security": /max-age=\d+/,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": /frame-ancestors 'none'/,
  "permissions-policy": /geolocation=\(\)/,
  "cache-control": "no-store",
};

function expectSecurityHeaders(res: Response) {
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const v = res.headers.get(name);
    if (typeof expected === "string") expect(v, name).toBe(expected);
    else expect(v ?? "", name).toMatch(expected);
  }
}

test("GET /health is public and carries every security header", async () => {
  const res = await app.request("/health", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: "api" });
  expectSecurityHeaders(res);
});

test("security headers are present on 404 and 401 responses too", async () => {
  expectSecurityHeaders(await app.request("/nope", {}, env));
  expectSecurityHeaders(await app.request("/ping", {}, env)); // 401 once Task 7 lands; 404 before — headers must be there either way
});

test("CORS: foreign Origin gets no Access-Control-Allow-Origin; allowed origin does, including preflight", async () => {
  const ok = await app.request("/health", { headers: { origin: "https://app.test" } }, env);
  expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.test");
  expect(ok.headers.get("vary")).toContain("Origin");

  const bad = await app.request("/health", { headers: { origin: "https://evil.test" } }, env);
  expect(bad.headers.get("access-control-allow-origin")).toBeNull();

  const badPreflight = await app.request(
    "/ping",
    {
      method: "OPTIONS",
      headers: { origin: "https://evil.test", "access-control-request-method": "GET" },
    },
    env,
  );
  expect(badPreflight.headers.get("access-control-allow-origin")).toBeNull();

  const goodPreflight = await app.request(
    "/ping",
    {
      method: "OPTIONS",
      headers: {
        origin: "https://app.test",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    },
    env,
  );
  expect(goodPreflight.status).toBe(204);
  expect(goodPreflight.headers.get("access-control-allow-origin")).toBe("https://app.test");
  expect(goodPreflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
    "authorization",
  );
  expect(goodPreflight.headers.get("access-control-allow-methods")).toContain("GET");
});

test("unknown route returns JSON 404", async () => {
  const res = await app.request("/nope", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found", message: "Not found" });
});

test("an unexpected exception returns a generic 500 with no stack trace or message leakage", async () => {
  const boom = createApp();
  boom.get("/boom", () => {
    throw new Error("secret internal detail: db password is hunter2");
  });
  const res = await boom.request("/boom", {}, env);
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: "internal", message: "Internal error" });
  expect(text).not.toMatch(/hunter2|at .*\.ts:\d+|Error:/);
  expectSecurityHeaders(res);
});
