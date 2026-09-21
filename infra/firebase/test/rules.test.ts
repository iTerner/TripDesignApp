import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

/** Must equal the placeholder in firestore.rules. It can never collide with a real Firebase UID. */
const ADMIN_UID = "TEST_ADMIN_UID";
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-wayfare",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { tier: "free" });
    await setDoc(doc(db, "users/bob"), { tier: "plus" });
    await setDoc(doc(db, "config/current"), { version: 1 });
    await setDoc(doc(db, "metrics/global"), { totalUsers: 2 });
    await setDoc(doc(db, "usageDaily/google_2026-09-20"), { total: 5 });
  });
});
afterAll(async () => env.cleanup());

const asUser = (uid: string) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("anonymous reads and writes are denied everywhere", async () => {
  await assertFails(getDoc(doc(anon(), "users/alice")));
  await assertFails(getDoc(doc(anon(), "config/current")));
  await assertFails(setDoc(doc(anon(), "users/x"), { tier: "plus" }));
});

test("a user reads their own document but not another user's", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "users/alice")));
  await assertFails(getDoc(doc(asUser("alice"), "users/bob")));
});

test("clients cannot write users, config or metrics — not even the admin", async () => {
  await assertFails(setDoc(doc(asUser("alice"), "users/alice"), { tier: "plus" }));
  await assertFails(setDoc(doc(asUser("alice"), "config/current"), { version: 2 }));
  await assertFails(setDoc(doc(asUser(ADMIN_UID), "metrics/global"), { totalUsers: 0 }));
});

test("signed-in users can read config/current", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "config/current")));
});

test("only the admin uid reads metrics and usage", async () => {
  await assertFails(getDoc(doc(asUser("alice"), "metrics/global")));
  await assertFails(getDoc(doc(asUser("alice"), "usageDaily/google_2026-09-20")));
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "metrics/global")));
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "usageDaily/google_2026-09-20")));
});

test("unverified email is treated as anonymous", async () => {
  const db = env.authenticatedContext("alice", { email_verified: false }).firestore();
  await assertFails(getDoc(doc(db, "users/alice")));
});

test("unknown collections are denied", async () => {
  await assertFails(getDoc(doc(asUser(ADMIN_UID), "plans/anything")));
});

const ALL_COLLECTIONS = [
  "users/alice",
  "users/alice/usage/2026-09",
  "plans/p1",
  "plans/p1/versions/v1",
  "config/current",
  "configVersions/1",
  "metrics/global",
  "metricsDaily/2026-09-20",
  "usageDaily/google_2026-09-20",
  "llmModels/m",
  "auditLog/a",
  "places/x",
  "shares/s",
];

test.each(ALL_COLLECTIONS)("anonymous cannot read or write %s", async (path) => {
  await assertFails(getDoc(doc(anon(), path)));
  await assertFails(setDoc(doc(anon(), path), { x: 1 }));
});

test("a user cannot read or write another user's users/* or plans/*", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "plans/bobs-plan"), { ownerUid: "bob" });
    await setDoc(doc(ctx.firestore(), "users/bob/usage/2026-09"), { plansCreated: 1 });
  });
  await assertFails(getDoc(doc(asUser("alice"), "users/bob/usage/2026-09")));
  await assertFails(setDoc(doc(asUser("alice"), "users/bob"), { tier: "free" }));
  await assertFails(getDoc(doc(asUser("alice"), "plans/bobs-plan")));
  await assertFails(setDoc(doc(asUser("alice"), "plans/bobs-plan"), { ownerUid: "alice" }));
});

test.each([
  "config/current",
  "configVersions/1",
  "llmModels/m",
  "usageDaily/google_2026-09-20",
  "metrics/global",
  "metricsDaily/2026-09-20",
  "auditLog/a",
])("client writes to %s are denied even for the admin UID", async (path) => {
  await assertFails(setDoc(doc(asUser(ADMIN_UID), path), { hacked: true }));
  await assertFails(setDoc(doc(asUser("alice"), path), { hacked: true }));
});

test("admin UID can read config/current (like any signed-in user) and admin-only telemetry", async () => {
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "config/current")));
  await assertSucceeds(getDoc(doc(asUser(ADMIN_UID), "metrics/global")));
});
