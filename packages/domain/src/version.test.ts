import { DOMAIN_VERSION } from "./version";

test("domain package exposes a semver version", () => {
  expect(DOMAIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
