import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "../../apps/web/dist");
const PATTERNS: [RegExp, string][] = [
  [/sk-or-v1-[0-9a-f]{64}/, "OpenRouter key"],
  [/tvly-[0-9A-Za-z_-]{20,}/, "Tavily key"],
  [/"private_key"/, "service-account private key field"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "private key block"],
  [
    /securetoken@system\.gserviceaccount\.com/,
    "server-side JWKS URL (Worker code leaked into the bundle)",
  ],
  [
    /oauth2\.googleapis\.com\/token/,
    "service-account token exchange (Worker code leaked into the bundle)",
  ],
];
// The Firebase web apiKey (AIza…) is public by design and expected in the bundle; it is NOT a secret and is not scanned.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory()
      ? walk(p)
      : p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".html")
        ? [p]
        : [];
  });
}

const skip = !existsSync(DIST);
(skip ? test.skip : test)("apps/web/dist contains no server secrets", () => {
  const files = walk(DIST);
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const [re, label] of PATTERNS) if (re.test(text)) hits.push(`${label} in ${f}`);
  }
  expect(hits).toEqual([]);
});
