import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cfg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../infra/firebase/firebase.json"), "utf8"),
) as {
  hosting: {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
};

function rule(source: string) {
  return cfg.hosting.headers.find((h) => h.source === source);
}

function header(source: string, key: string): string {
  const value = rule(source)?.headers.find((h) => h.key === key)?.value;
  if (!value) throw new Error(`missing ${key} on ${source}`);
  return value;
}

test("hosting CSP connect-src is the Worker and Google auth hosts only", () => {
  const csp = header("**", "Content-Security-Policy");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("*.googleapis.com");
  const connect = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
  const origins = connect.split(/\s+/).filter((o) => o !== "'self'");
  expect(origins).toEqual([
    "https://wayfare-api.ido-terner.workers.dev",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://firebaseinstallations.googleapis.com",
    "https://apis.google.com",
    "https://accounts.google.com",
  ]);
});

test("every hosting path is no-store, with hashed assets overriding later", () => {
  const headers = cfg.hosting.headers;
  const star = headers.findIndex((h) => h.source === "**");
  const assets = headers.findIndex((h) => h.source === "/assets/**");
  expect(star).toBeGreaterThanOrEqual(0);
  expect(assets).toBeGreaterThan(star);
  expect(header("**", "Cache-Control")).toBe("no-cache, no-store, must-revalidate");
  expect(header("/assets/**", "Cache-Control")).toBe("public, max-age=31536000, immutable");
});
