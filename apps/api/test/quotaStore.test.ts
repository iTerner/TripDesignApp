import { env } from "cloudflare:test";
import { DEFAULT_REGISTRY } from "@wayfare/domain";
import { FirestoreClient } from "@wayfare/firestore";
import { FirestoreQuotaStore } from "../src/firestore/quotaStore";

const NOW = new Date("2026-09-20T12:00:00Z");

function recordingDb() {
  const commits: { path: string; inc: Record<string, number> }[] = [];
  const db = new FirestoreClient({
    projectId: "p",
    tokenProvider: async () => "T",
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  db.incrementFields = async (path, inc) => {
    commits.push({ path, inc });
  };
  return { db, commits };
}

test("exhaustion flag lives in KV and is ignored once past its instant", async () => {
  const store = new FirestoreQuotaStore({ db: recordingDb().db, kv: env.CONFIG_KV });
  expect(await store.isExhausted("google:gemini-3.8-flash", NOW)).toBe(false);
  await store.markExhausted("google:gemini-3.8-flash", "2026-09-21T07:00:00.000Z");
  expect(await store.isExhausted("google:gemini-3.8-flash", NOW)).toBe(true);
  expect(await store.isExhausted("google:gemini-3.8-flash", new Date("2026-09-21T08:00:00Z"))).toBe(
    false,
  );
});

test("recordCall increments the per-model outcome and total in the provider-day document", async () => {
  const { db, commits } = recordingDb();
  const store = new FirestoreQuotaStore({ db, kv: env.CONFIG_KV });
  const entry = DEFAULT_REGISTRY.models.find((m) => m.id === "google:gemini-3.8-flash");
  if (!entry) throw new Error("registry changed");
  await store.recordCall(entry, "ok", NOW);
  expect(commits[0]).toEqual({
    path: "usageDaily/google_2026-09-20",
    inc: { "google:gemini-3.8-flash.ok": 1, total: 1 },
  });
});
