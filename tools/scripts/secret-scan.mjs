// Scans staged files (or paths given as args) for secret-looking strings. Exit 1 on any hit.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATTERNS = [
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/sk-or-v1-[0-9a-f]{64}/, "OpenRouter key"],
  [/tvly-[0-9A-Za-z_-]{20,}/, "Tavily key"],
  [/"private_key"\s*:\s*"-----BEGIN/, "Service-account private key"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key block"],
  [/ghp_[0-9A-Za-z]{36}/, "GitHub token"],
  [/cfut_[0-9A-Za-z_-]{30,}/, "Cloudflare API token"],
];
const ALLOW = [
  /\.example$/,
  /secret-scan\.mjs$/,
  /\/test\/helpers\/testPem\.ts$/,
  /pnpm-lock\.yaml$/,
];

const gitleaks = spawnSync("gitleaks", ["version"], { stdio: "ignore" });
if (gitleaks.status === 0) {
  const r = spawnSync("gitleaks", ["protect", "--staged", "--redact", "--no-banner"], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

// `git diff --name-only` paths are relative to the repo root, but the hook runs this script
// from `tools/` (pnpm --filter), so resolve them against the top-level directory.
const files =
  process.argv.length > 2
    ? process.argv.slice(2).map((f) => ({ name: f, path: f }))
    : (() => {
        const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
          encoding: "utf8",
        }).trim();
        return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
          encoding: "utf8",
        })
          .split("\n")
          .filter(Boolean)
          .map((f) => ({ name: f, path: resolve(root, f) }));
      })();

let hits = 0;
for (const { name, path } of files) {
  if (ALLOW.some((a) => a.test(name))) continue;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.warn(`[secret-scan] skipped unreadable file ${name}`);
    continue;
  }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) {
      console.error(`[secret-scan] ${label} in ${name}`);
      hits += 1;
    }
  }
}
if (hits) {
  console.error(`[secret-scan] ${hits} potential secret(s) found. Commit aborted.`);
  process.exit(1);
}
console.log("[secret-scan] clean");
