import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../scripts/secret-scan.mjs");
// Assembled at runtime so this test file itself does not trip the pre-commit scanner.
const PEM_HEADER = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");

function scan(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  const file = join(dir, "leak.ts");
  writeFileSync(file, content);
  return spawnSync("node", [SCRIPT, file], { encoding: "utf8" });
}

test("flags a Google API key and a service-account private key", () => {
  expect(scan(`const k = "AIza${"A".repeat(35)}";`).status).toBe(1);
  expect(scan(`{"private_key": "${PEM_HEADER}\\nabc"}`).status).toBe(1);
});

test("flags a Cloudflare API token", () => {
  // Assembled at runtime so this test file itself does not trip the pre-commit scanner.
  const token = `cfut_${"x".repeat(40)}`;
  expect(scan(`const t = "${token}";`).status).toBe(1);
});

test("passes clean code", () => {
  expect(scan(`export const x = 1;`).status).toBe(0);
});

test("flags a key in a .example file (committed examples are not exempt)", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-ex-"));
  const file = join(dir, ".env.production.example");
  writeFileSync(file, `VITE_FIREBASE_API_KEY=AIza${"A".repeat(35)}\n`);
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  expect(r.status).toBe(1);
});

test("explicit paths are still scanned when a gitleaks command is on PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-gl-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const shim = process.platform === "win32" ? "gitleaks.cmd" : "gitleaks";
  writeFileSync(
    join(bin, shim),
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  );
  if (process.platform !== "win32") spawnSync("chmod", ["+x", join(bin, shim)]);
  const file = join(dir, "leak.ts");
  writeFileSync(file, `const k = "AIza${"A".repeat(35)}";`);
  const sep = process.platform === "win32" ? ";" : ":";
  const r = spawnSync(process.execPath, [SCRIPT, file], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${sep}${process.env.PATH ?? ""}` },
  });
  expect(r.status).toBe(1);
});

test("tracked env examples contain no Google API key material", () => {
  const root = resolve(import.meta.dirname, "../..");
  for (const rel of [
    ".env.example",
    "apps/api/.dev.vars.example",
    "apps/web/.env.example",
    "apps/web/.env.production.example",
  ]) {
    expect(readFileSync(resolve(root, rel), "utf8"), rel).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
  }
});

test("staged scan still flags project patterns when gitleaks exits clean", () => {
  const repo = mkdtempSync(join(tmpdir(), "scan-glrepo-"));
  const bin = join(repo, "bin");
  mkdirSync(bin);
  const shim = process.platform === "win32" ? "gitleaks.cmd" : "gitleaks";
  writeFileSync(
    join(bin, shim),
    process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  );
  if (process.platform !== "win32") spawnSync("chmod", ["+x", join(bin, shim)]);
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(repo, "leak.ts"), `const k = "AIza${"A".repeat(35)}";`);
  git("add", "leak.ts");
  const sep = process.platform === "win32" ? ";" : ":";
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${sep}${process.env.PATH ?? ""}` },
  });
  expect(r.status).toBe(1);
}, 20_000);

test("staged mode flags a leak even when run from a subdirectory (pre-commit hook cwd)", () => {
  const repo = mkdtempSync(join(tmpdir(), "scan-repo-"));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(join(repo, "leak.ts"), `const k = "AIza${"A".repeat(35)}";`);
  git("add", "leak.ts");
  const sub = join(repo, "sub");
  mkdirSync(sub);
  const r = spawnSync("node", [SCRIPT], { cwd: sub, encoding: "utf8" });
  expect(r.status).toBe(1);
});
