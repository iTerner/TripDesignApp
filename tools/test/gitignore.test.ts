import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
/** Each path must be ignored by git; if any is tracked-able the test fails. */
const MUST_BE_IGNORED = [
  ".env",
  ".env.production",
  "apps/api/.dev.vars",
  "apps/web/.env",
  "apps/web/.env.production",
  "wayfare-service-account.json",
  "infra/service-account-prod.json",
  "keys/private.pem",
  "cert.p12",
  "id_rsa.key",
];
const MUST_NOT_BE_IGNORED = [
  ".env.example",
  "apps/api/.dev.vars.example",
  "apps/web/.env.production.example",
];

function isIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test.each(MUST_BE_IGNORED)("%s is git-ignored", (p) => {
  expect(isIgnored(p)).toBe(true);
});

test.each(MUST_NOT_BE_IGNORED)("%s is NOT git-ignored (examples must be committed)", (p) => {
  expect(isIgnored(p)).toBe(false);
});
