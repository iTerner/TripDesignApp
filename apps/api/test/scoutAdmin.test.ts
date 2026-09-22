import { env } from "cloudflare:test";
import { CreateDestinationResponseSchema, CreateReviewResponseSchema } from "@wayfare/domain";
import { type FirestoreValue, fromFirestoreValue, toFirestoreValue } from "@wayfare/firestore";
import { createApp } from "../src/app";
import { TEST_SA_JSON } from "./helpers/testPem";
import { makeTestJwks } from "./helpers/tokens";

const NOW = new Date("2026-09-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const AT = NOW.toISOString();

/**
 * In-memory Firestore REST double for the Worker routes: document GET/PATCH
 * (including dotted update masks), list pagination, delete, and increments.
 */
function memoryFirestore(projectId = "test-project") {
  const docs = new Map<string, Record<string, unknown>>();
  const patches: { path: string; mask: string[] }[] = [];
  const prefix = `/v1/projects/${projectId}/databases/(default)/documents/`;

  const encodeFields = (data: Record<string, unknown>): Record<string, FirestoreValue> => {
    const encoded = toFirestoreValue(data);
    if (!("mapValue" in encoded)) throw new Error("document must be a map");
    return encoded.mapValue.fields ?? {};
  };

  const docName = (path: string) => `projects/${projectId}/databases/(default)/documents/${path}`;

  const writePath = (obj: Record<string, unknown>, parts: string[], value: unknown) => {
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i] as string;
      const next = cur[key];
      if (!next || typeof next !== "object" || Array.isArray(next)) cur[key] = {};
      cur = cur[key] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    cur[last] = structuredClone(value);
  };

  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });
    }
    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.pathname.endsWith(":commit")) {
      const body = JSON.parse(String(init?.body)) as {
        writes: Array<{
          transform: {
            document: string;
            fieldTransforms: Array<{
              fieldPath: string;
              increment: { integerValue?: string; doubleValue?: number };
            }>;
          };
        }>;
      };
      for (const w of body.writes) {
        const path = w.transform.document.split("/documents/")[1] as string;
        const cur = docs.get(path) ?? {};
        for (const t of w.transform.fieldTransforms) {
          const field = t.fieldPath.replace(/^`|`$/g, "");
          cur[field] =
            Number(cur[field] ?? 0) +
            Number(t.increment.integerValue ?? t.increment.doubleValue ?? 0);
        }
        docs.set(path, cur);
      }
      return new Response("{}", { status: 200 });
    }
    if (!u.pathname.startsWith(prefix)) {
      throw new Error(`unexpected firestore ${method} ${url}`);
    }
    const path = decodeURIComponent(u.pathname.slice(prefix.length));
    const segments = path.split("/").filter(Boolean);

    if (method === "DELETE") {
      if (!docs.has(path)) return new Response("{}", { status: 404 });
      docs.delete(path);
      return new Response("{}", { status: 200 });
    }

    if (method === "PATCH") {
      const exists = u.searchParams.get("currentDocument.exists");
      if (exists === "true" && !docs.has(path)) return new Response("{}", { status: 404 });
      if (exists === "false" && docs.has(path)) return new Response("{}", { status: 409 });
      const body = JSON.parse(String(init?.body)) as { fields: Record<string, FirestoreValue> };
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.fields)) patch[k] = fromFirestoreValue(v);
      const mask = u.searchParams.getAll("updateMask.fieldPaths");
      const cur = docs.get(path) ?? {};
      const fields = mask.length > 0 ? mask : Object.keys(patch);
      for (const fieldPath of fields)
        writePath(cur, fieldPath.split("."), readPath(patch, fieldPath.split(".")));
      docs.set(path, cur);
      patches.push({ path, mask: fields });
      return new Response("{}", { status: 200 });
    }

    if (segments.length % 2 === 1) {
      const pageSize = Number(u.searchParams.get("pageSize") ?? "300");
      const pageToken = u.searchParams.get("pageToken");
      const children = [...docs.keys()]
        .filter((docPath) => {
          if (!docPath.startsWith(`${path}/`)) return false;
          const rest = docPath.slice(path.length + 1);
          return rest.length > 0 && !rest.includes("/");
        })
        .sort();
      let start = 0;
      if (pageToken) {
        const idx = children.indexOf(pageToken);
        if (idx === -1) return new Response("{}", { status: 200 });
        start = idx + 1;
      }
      const slice = children.slice(start, start + pageSize);
      const next =
        start >= 0 && start + pageSize < children.length ? slice[slice.length - 1] : undefined;
      const payload: { documents?: unknown[]; nextPageToken?: string } = {};
      if (slice.length > 0) {
        payload.documents = slice.map((docPath) => ({
          name: docName(docPath),
          fields: encodeFields(docs.get(docPath) as Record<string, unknown>),
        }));
      }
      if (next) payload.nextPageToken = next;
      return new Response(JSON.stringify(payload), { status: 200 });
    }

    const doc = docs.get(path);
    if (!doc) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ name: docName(path), fields: encodeFields(doc) }), {
      status: 200,
    });
  };

  return { docs, patches, fetchImpl };
}

function readPath(obj: Record<string, unknown>, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const DISPATCH_TOKEN = "dispatch-test-token";

async function setup(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  extra: { GITHUB_DISPATCH_TOKEN?: string } = {},
) {
  const jwks = await makeTestJwks();
  const app = createApp({ jwks: jwks.getKey, now: () => NOW, fetchImpl });
  const bindings = {
    ...env,
    FIREBASE_SERVICE_ACCOUNT: TEST_SA_JSON,
    GITHUB_DISPATCH_TOKEN: extra.GITHUB_DISPATCH_TOKEN ?? DISPATCH_TOKEN,
  };
  const token = (sub: string, authTime = nowSec - 30) => jwks.sign({ sub, auth_time: authTime });
  const call = (method: string, path: string, bearer: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      bindings,
    );
  return { token, call };
}

test("non-admin → 403 on every scout admin write", async () => {
  const fs = memoryFirestore();
  const { token, call } = await setup(fs.fetchImpl);
  const bearer = await token("someone-else");
  for (const [method, path] of [
    ["POST", "/admin/scout/destinations"],
    ["POST", "/admin/scout/destinations/reorder"],
    ["DELETE", "/admin/scout/destinations/tuscany"],
    ["POST", "/admin/scout/run"],
    ["POST", "/admin/places/p1/overrides"],
    ["POST", "/admin/places/p1/hide"],
    ["POST", "/admin/merges/m1"],
    ["POST", "/admin/reviews"],
    ["POST", "/admin/reviews/rev_1/verdict"],
  ] as const) {
    const res = await call(method, path, bearer, method === "DELETE" ? undefined : {});
    expect(res.status, `${method} ${path}`).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  }
  expect(fs.patches).toEqual([]);
});

function auditRows(docs: Map<string, Record<string, unknown>>): Record<string, unknown>[] {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith("auditLog/"))
    .map(([, data]) => data);
}

test("stale auth_time on POST → 401 reauth_required; fresh run dispatches Gemini", async () => {
  const fs = memoryFirestore();
  const github: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://api.github.com/")) {
      github.push({ url, init });
      return new Response(null, { status: 204 });
    }
    return fs.fetchImpl(url, init);
  };
  const { token, call } = await setup(fetchImpl);
  const stale = await token("admin-uid-1", nowSec - 16 * 60);
  const staleRes = await call("POST", "/admin/scout/destinations", stale, {
    slug: "tuscany",
    name: "Tuscany",
    kind: "region",
  });
  expect(staleRes.status).toBe(401);
  expect(await staleRes.json()).toMatchObject({ error: "reauth_required" });
  expect(fs.patches).toEqual([]);

  const fresh = await token("admin-uid-1", nowSec - 14 * 60);
  const run = await call("POST", "/admin/scout/run", fresh, { slug: "tuscany" });
  expect(run.status).toBe(200);
  expect(await run.json()).toEqual({ ok: true, slug: "tuscany" });
  expect(github).toHaveLength(1);
  const headers = github[0]?.init?.headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${DISPATCH_TOKEN}`);
  expect(JSON.parse(String(github[0]?.init?.body))).toEqual({
    ref: "master",
    inputs: { destinations: "tuscany", backend: "gemini" },
  });
  const audits = auditRows(fs.docs);
  expect(audits).toEqual([
    {
      action: "scout.run",
      target: "destinations/tuscany",
      actorUid: "admin-uid-1",
      at: AT,
    },
  ]);
  expect(JSON.stringify(audits)).not.toContain(DISPATCH_TOKEN);
});

test("scout run hides a non-204 GitHub body and skips dispatch when unset", async () => {
  const marker = "upstream-body-marker";
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ token: DISPATCH_TOKEN, detail: marker }), { status: 422 });
  };
  const { token, call } = await setup(fetchImpl);
  const fresh = await token("admin-uid-1");
  const failed = await call("POST", "/admin/scout/run", fresh, { slug: "tuscany" });
  expect(failed.status).toBe(503);
  const failedBody = await failed.json();
  expect(failedBody).toEqual({ error: "upstream_exhausted", message: "GitHub HTTP 422" });
  expect(JSON.stringify(failedBody)).not.toContain(DISPATCH_TOKEN);
  expect(JSON.stringify(failedBody)).not.toContain(marker);

  const bad = await call("POST", "/admin/scout/run", fresh, { slug: "Tuscany" });
  expect(bad.status).toBe(400);
  expect(calls).toBe(1);

  const unset = await setup(
    async () => {
      calls += 1;
      throw new Error("github should not be called");
    },
    { GITHUB_DISPATCH_TOKEN: "" },
  );
  const missing = await unset.call("POST", "/admin/scout/run", await unset.token("admin-uid-1"), {
    slug: "tuscany",
  });
  expect(missing.status).toBe(503);
  expect(await missing.json()).toEqual({
    error: "upstream_exhausted",
    message: "GitHub dispatch is not configured",
  });
  expect(calls).toBe(1);
});

test("GET scout paths are not added", async () => {
  const fetchImpl = async () => {
    throw new Error("reads are client SDK, not Worker routes");
  };
  const { token, call } = await setup(fetchImpl);
  const admin = await token("admin-uid-1");
  const stranger = await token("someone-else");
  expect((await call("GET", "/admin/scout/destinations", admin)).status).toBe(404);
  expect((await call("GET", "/admin/places/p1", admin)).status).toBe(404);
  expect((await call("GET", "/admin/merges/m1", admin)).status).toBe(404);
  expect((await call("GET", "/admin/reviews/rev_1", admin)).status).toBe(404);
  const denied = await call("GET", "/admin/scout/destinations", stranger);
  expect(denied.status).toBe(403);
});

test("create destination queues it as admin and assigns queueOrder", async () => {
  const fs = memoryFirestore();
  const { token, call } = await setup(fs.fetchImpl);
  const bearer = await token("admin-uid-1");
  const first = await call("POST", "/admin/scout/destinations", bearer, {
    slug: "tuscany",
    name: "Tuscany",
    kind: "region",
  });
  expect(first.status).toBe(200);
  expect(CreateDestinationResponseSchema.parse(await first.json())).toEqual({
    ok: true,
    slug: "tuscany",
    status: "queued",
    queueOrder: 0,
  });
  expect(fs.docs.get("destinations/tuscany")).toMatchObject({
    slug: "tuscany",
    name: "Tuscany",
    kind: "region",
    status: "queued",
    requestedBy: "admin",
    queueOrder: 0,
    counts: { scouted: 0, userFound: 0, trending: 0, hidden: 0 },
  });
  expect(JSON.stringify(fs.docs.get("destinations/tuscany"))).not.toContain("admin-uid-1");

  const second = await call("POST", "/admin/scout/destinations", bearer, {
    slug: "rome",
    name: "Rome",
    kind: "city",
    geometry: {
      bbox: { south: 41.6, west: 12.2, north: 42.0, east: 12.8 },
      center: { lat: 41.9, lng: 12.5 },
    },
  });
  expect(second.status).toBe(200);
  expect(CreateDestinationResponseSchema.parse(await second.json()).queueOrder).toBe(1);
  expect(fs.docs.get("destinations/rome")).toMatchObject({
    queueOrder: 1,
    geometry: { center: { lat: 41.9, lng: 12.5 } },
  });

  const again = await call("POST", "/admin/scout/destinations", bearer, {
    slug: "tuscany",
    name: "Tuscany",
    kind: "region",
  });
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ error: "conflict" });
});

test("reorder writes queueOrder from the slug list", async () => {
  const fs = memoryFirestore();
  fs.docs.set("destinations/tuscany", { slug: "tuscany", queueOrder: 0, status: "queued" });
  fs.docs.set("destinations/rome", { slug: "rome", queueOrder: 1, status: "queued" });
  const { token, call } = await setup(fs.fetchImpl);
  const res = await call("POST", "/admin/scout/destinations/reorder", await token("admin-uid-1"), {
    slugs: ["rome", "tuscany"],
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    order: [
      { slug: "rome", queueOrder: 0 },
      { slug: "tuscany", queueOrder: 1 },
    ],
  });
  expect(fs.docs.get("destinations/rome")).toMatchObject({ queueOrder: 0 });
  expect(fs.docs.get("destinations/tuscany")).toMatchObject({ queueOrder: 1 });

  fs.patches.length = 0;
  const missing = await call(
    "POST",
    "/admin/scout/destinations/reorder",
    await token("admin-uid-1"),
    { slugs: ["rome", "missing-slug"] },
  );
  expect(missing.status).toBe(404);
  expect(fs.patches).toEqual([]);
  expect(fs.docs.get("destinations/rome")).toMatchObject({ queueOrder: 0 });
});

test("delete removes a queued destination with no places, otherwise 409", async () => {
  const fs = memoryFirestore();
  fs.docs.set("destinations/tuscany", { slug: "tuscany", status: "queued" });
  fs.docs.set("destinations/florence", { slug: "florence", status: "ready" });
  fs.docs.set("destinations/sicily", { slug: "sicily", status: "queued" });
  fs.docs.set("places/p1", { id: "p1", destSlug: "sicily", status: "active" });
  const { token, call } = await setup(fs.fetchImpl);
  const bearer = await token("admin-uid-1");

  const ready = await call("DELETE", "/admin/scout/destinations/florence", bearer);
  expect(ready.status).toBe(409);
  expect(await ready.json()).toMatchObject({ error: "conflict" });
  expect(fs.docs.has("destinations/florence")).toBe(true);

  const hasPlaces = await call("DELETE", "/admin/scout/destinations/sicily", bearer);
  expect(hasPlaces.status).toBe(409);
  expect(fs.docs.has("destinations/sicily")).toBe(true);
  expect(fs.docs.has("places/p1")).toBe(true);

  const ok = await call("DELETE", "/admin/scout/destinations/tuscany", bearer);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true, slug: "tuscany" });
  expect(fs.docs.has("destinations/tuscany")).toBe(false);
});

test("override sets by admin and a private note, and does not patch status", async () => {
  const fs = memoryFirestore();
  fs.docs.set("places/p1", {
    id: "p1",
    status: "active",
    dwellMin: 90,
    adminOverrides: {
      name: { value: "Old name", by: "admin", at: "2026-09-01T00:00:00.000Z" },
    },
  });
  const { token, call } = await setup(fs.fetchImpl);
  const res = await call("POST", "/admin/places/p1/overrides", await token("admin-uid-1"), {
    field: "dwellMin",
    value: 120,
    note: "stayed longer",
  });
  expect(res.status).toBe(200);
  const place = fs.docs.get("places/p1");
  expect(place).toMatchObject({
    status: "active",
    dwellMin: 90,
    adminOverrides: {
      name: { value: "Old name", by: "admin", at: "2026-09-01T00:00:00.000Z" },
      dwellMin: { value: 120, by: "admin", at: AT },
    },
  });
  expect(JSON.stringify(place)).not.toContain("admin-uid-1");
  expect(JSON.stringify(place?.adminOverrides)).not.toContain("stayed longer");
  expect(fs.docs.get("places/p1/private/admin")).toEqual({
    notes: { dwellMin: "stayed longer" },
  });
  const overrideAudit = auditRows(fs.docs);
  expect(overrideAudit).toMatchObject([
    { action: "place.override", target: "places/p1", actorUid: "admin-uid-1", at: AT },
  ]);
  expect(JSON.stringify(overrideAudit)).not.toContain("stayed longer");
  expect(JSON.stringify(place)).not.toContain("admin-uid-1");
  expect(fs.patches.find((p) => p.path === "places/p1")?.mask).toEqual(["adminOverrides.dwellMin"]);
  expect(fs.patches.find((p) => p.path === "places/p1")?.mask).not.toContain("status");

  fs.patches.length = 0;
  const blocked = await call("POST", "/admin/places/p1/overrides", await token("admin-uid-1"), {
    field: "status",
    value: "hidden",
  });
  expect(blocked.status).toBe(400);
  expect(await blocked.json()).toMatchObject({ error: "bad_request" });
  expect(fs.patches).toEqual([]);
  expect(fs.docs.get("places/p1")).toMatchObject({ status: "active" });
});

test("hide sets status and the private reason; the mask is status only", async () => {
  const fs = memoryFirestore();
  fs.docs.set("places/p1", {
    id: "p1",
    status: "active",
    adminOverrides: { dwellMin: { value: 120, by: "admin", at: AT } },
  });
  fs.docs.set("places/p1/private/admin", { notes: { dwellMin: "keep me" } });
  const { token, call } = await setup(fs.fetchImpl);
  const res = await call("POST", "/admin/places/p1/hide", await token("admin-uid-1"), {
    reason: "closed for good",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, id: "p1", status: "hidden" });
  expect(fs.docs.get("places/p1")).toMatchObject({
    status: "hidden",
    adminOverrides: { dwellMin: { value: 120, by: "admin", at: AT } },
  });
  expect(fs.docs.get("places/p1/private/admin")).toEqual({
    notes: { dwellMin: "keep me" },
    hideReason: "closed for good",
  });
  expect(fs.patches.find((p) => p.path === "places/p1")?.mask).toEqual(["status"]);
  expect(JSON.stringify(fs.docs.get("places/p1/private/admin"))).not.toContain("admin-uid-1");
  const hideAudit = auditRows(fs.docs);
  expect(hideAudit).toEqual([
    { action: "place.hide", target: "places/p1", actorUid: "admin-uid-1", at: AT },
  ]);
  expect(JSON.stringify(hideAudit)).not.toContain("closed for good");
  expect(JSON.stringify(fs.docs.get("places/p1"))).not.toContain("admin-uid-1");
});

test("merge keeps the winner, unions sources and evidence, and tombstones the loser", async () => {
  const fs = memoryFirestore();
  fs.docs.set("pendingMerges/m1", {
    id: "m1",
    destSlug: "tuscany",
    placeIdA: "a",
    placeIdB: "b",
    status: "open",
  });
  fs.docs.set("places/a", {
    id: "a",
    name: "Cathedral",
    status: "active",
    sources: [{ kind: "osm", ref: "way/1" }],
    aliases: ["Il Duomo"],
  });
  fs.docs.set("places/b", {
    id: "b",
    name: "Duomo di Firenze",
    status: "active",
    sources: [
      { kind: "osm", ref: "way/1" },
      { kind: "web", ref: "https://b.example" },
    ],
    aliases: ["The Duomo"],
  });
  fs.docs.set("places/a/evidence/e-a", { id: "e-a", placeId: "a", quote: "winner" });
  fs.docs.set("places/a/evidence/e-shared", { id: "e-shared", placeId: "a", quote: "winner copy" });
  fs.docs.set("places/b/evidence/e-b", { id: "e-b", placeId: "b", quote: "loser" });
  fs.docs.set("places/b/evidence/e-shared", { id: "e-shared", placeId: "b", quote: "loser copy" });
  const { token, call } = await setup(fs.fetchImpl);
  const res = await call("POST", "/admin/merges/m1", await token("admin-uid-1"), {
    action: "merge",
    keep: "a",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, id: "m1", status: "merged" });
  expect(fs.docs.get("places/a")).toMatchObject({
    status: "active",
    aliases: ["Il Duomo", "Duomo di Firenze"],
    sources: [
      { kind: "osm", ref: "way/1" },
      { kind: "web", ref: "https://b.example" },
    ],
  });
  expect(fs.docs.get("places/b")).toMatchObject({
    status: "tombstoned",
    mergedInto: "a",
    name: "Duomo di Firenze",
  });
  expect(fs.docs.get("places/a/evidence/e-b")).toMatchObject({
    id: "e-b",
    placeId: "a",
    quote: "loser",
  });
  expect(fs.docs.get("places/a/evidence/e-shared")).toMatchObject({ quote: "winner copy" });
  expect(fs.docs.get("places/b/evidence/e-b")).toMatchObject({ placeId: "b" });
  expect(fs.docs.get("pendingMerges/m1")).toMatchObject({
    status: "merged",
    resolvedBy: "admin",
    resolvedAt: AT,
  });
  expect(JSON.stringify(fs.docs.get("pendingMerges/m1"))).not.toContain("admin-uid-1");
  expect(fs.patches.find((p) => p.path === "places/a")?.mask).toEqual(["sources", "aliases"]);
  expect(fs.patches.find((p) => p.path === "places/b")?.mask).toEqual(["status", "mergedInto"]);
});

test("keep_both marks the merge and changes neither place", async () => {
  const fs = memoryFirestore();
  fs.docs.set("pendingMerges/m2", { id: "m2", placeIdA: "a", placeIdB: "b", status: "open" });
  fs.docs.set("places/a", { id: "a", name: "A", status: "active", aliases: [], sources: [] });
  fs.docs.set("places/b", { id: "b", name: "B", status: "active", aliases: [], sources: [] });
  const beforeA = structuredClone(fs.docs.get("places/a"));
  const beforeB = structuredClone(fs.docs.get("places/b"));
  const { token, call } = await setup(fs.fetchImpl);
  const res = await call("POST", "/admin/merges/m2", await token("admin-uid-1"), {
    action: "keep_both",
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, id: "m2", status: "kept_both" });
  expect(fs.docs.get("places/a")).toEqual(beforeA);
  expect(fs.docs.get("places/b")).toEqual(beforeB);
  expect(fs.patches.map((p) => p.path).filter((path) => !path.startsWith("auditLog/"))).toEqual([
    "pendingMerges/m2",
  ]);
  expect(auditRows(fs.docs)).toMatchObject([
    { action: "merge.resolve", target: "pendingMerges/m2", actorUid: "admin-uid-1" },
  ]);
  expect(fs.docs.get("pendingMerges/m2")).toMatchObject({
    status: "kept_both",
    resolvedBy: "admin",
    resolvedAt: AT,
  });

  fs.patches.length = 0;
  const again = await call("POST", "/admin/merges/m2", await token("admin-uid-1"), {
    action: "keep_both",
  });
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ error: "conflict" });
  expect(fs.patches).toEqual([]);
});

test("review stores 30 random active ids and 30 top trendScore ids", async () => {
  const fs = memoryFirestore();
  for (let i = 0; i < 35; i++) {
    const id = `p${String(i).padStart(2, "0")}`;
    fs.docs.set(`places/${id}`, {
      id,
      destSlug: "tuscany",
      name: id,
      status: "active",
      runId: "run_1",
      lastSeenRunId: "run_1",
      trendScore: i,
    });
  }
  fs.docs.set("places/seen", {
    id: "seen",
    destSlug: "tuscany",
    name: "Seen",
    status: "active",
    runId: "run_0",
    lastSeenRunId: "run_1",
    trendScore: 100,
  });
  fs.docs.set("places/hidden", {
    id: "hidden",
    destSlug: "tuscany",
    name: "Hidden",
    status: "hidden",
    runId: "run_1",
    lastSeenRunId: "run_1",
    trendScore: 99,
  });
  fs.docs.set("places/other", {
    id: "other",
    destSlug: "umbria",
    name: "Other",
    status: "active",
    runId: "run_1",
    lastSeenRunId: "run_1",
    trendScore: 98,
  });
  fs.docs.set("places/old", {
    id: "old",
    destSlug: "tuscany",
    name: "Old",
    status: "active",
    runId: "run_0",
    lastSeenRunId: "run_0",
    trendScore: 97,
  });
  const { token, call } = await setup(fs.fetchImpl);
  const res = await call("POST", "/admin/reviews", await token("admin-uid-1"), {
    destSlug: "tuscany",
    runId: "run_1",
  });
  expect(res.status).toBe(200);
  const body = CreateReviewResponseSchema.parse(await res.json());
  expect(body.sampleSize).toBe(60);
  const session = fs.docs.get(`reviewSessions/${body.id}`) as {
    sample: Array<{ placeId: string; bucket: string }>;
    verdicts: Record<string, string>;
    accuracy: number;
    destSlug: string;
    runId: string;
  };
  expect(session.destSlug).toBe("tuscany");
  expect(session.runId).toBe("run_1");
  expect(session.accuracy).toBe(0);
  expect(session.verdicts).toEqual({});
  expect(session.sample).toHaveLength(60);
  for (const item of session.sample) {
    expect(Object.keys(item).sort()).toEqual(["bucket", "placeId"]);
  }
  const top = session.sample.filter((s) => s.bucket === "topTrend").map((s) => s.placeId);
  const random = session.sample.filter((s) => s.bucket === "random").map((s) => s.placeId);
  expect(top).toHaveLength(30);
  expect(random).toHaveLength(30);
  expect(top).toContain("seen");
  expect(top).toContain("p34");
  expect(top).toContain("p06");
  expect(top).not.toContain("p05");
  for (const id of [...top, ...random]) {
    expect(["hidden", "other", "old"]).not.toContain(id);
  }
  const allowed = new Set([
    ...Array.from({ length: 35 }, (_, i) => `p${String(i).padStart(2, "0")}`),
    "seen",
  ]);
  for (const id of random) expect(allowed.has(id)).toBe(true);
});

test("verdict records accuracy, flags a wrong place, and hide sets status", async () => {
  const fs = memoryFirestore();
  fs.docs.set("places/p1", {
    id: "p1",
    destSlug: "tuscany",
    name: "One",
    status: "active",
    runId: "run_1",
    lastSeenRunId: "run_1",
    trendScore: 10,
    timesFlagged: 0,
  });
  fs.docs.set("places/p2", {
    id: "p2",
    destSlug: "tuscany",
    name: "Two",
    status: "active",
    runId: "run_1",
    lastSeenRunId: "run_1",
    trendScore: 3,
    timesFlagged: 0,
  });
  const { token, call } = await setup(fs.fetchImpl);
  const bearer = await token("admin-uid-1");
  const created = await call("POST", "/admin/reviews", bearer, {
    destSlug: "tuscany",
    runId: "run_1",
  });
  expect(created.status).toBe(200);
  const createdBody = CreateReviewResponseSchema.parse(await created.json());
  expect(createdBody.sampleSize).toBe(4);
  const { id } = createdBody;

  const wrong = await call("POST", `/admin/reviews/${id}/verdict`, bearer, {
    placeId: "p1",
    verdict: "wrong",
    reason: "closed",
  });
  expect(wrong.status).toBe(200);
  expect(await wrong.json()).toEqual({ ok: true, id, accuracy: 0, completed: false });
  expect(fs.docs.get("places/p1")).toMatchObject({ status: "active", timesFlagged: 1 });
  expect(fs.docs.get(`reviewSessions/${id}`)).toMatchObject({
    verdicts: { p1: "wrong:closed" },
    accuracy: 0,
  });

  const correct = await call("POST", `/admin/reviews/${id}/verdict`, bearer, {
    placeId: "p2",
    verdict: "correct",
  });
  expect(correct.status).toBe(200);
  expect(await correct.json()).toEqual({ ok: true, id, accuracy: 0.5, completed: true });
  expect(fs.docs.get(`reviewSessions/${id}`)).toMatchObject({
    verdicts: { p1: "wrong:closed", p2: "correct" },
    accuracy: 0.5,
    completedAt: AT,
  });
  expect(fs.docs.get("places/p2")).toMatchObject({ status: "active", timesFlagged: 0 });

  const hide = await call("POST", `/admin/reviews/${id}/verdict`, bearer, {
    placeId: "p2",
    verdict: "hide",
  });
  expect(hide.status).toBe(200);
  expect(fs.docs.get("places/p2")).toMatchObject({ status: "hidden", timesFlagged: 0 });
  expect(fs.docs.get("places/p2/private/admin")).toEqual({ hideReason: "review" });
  expect(fs.patches.find((p) => p.path === "places/p2")?.mask).toEqual(["status"]);
  expect(JSON.stringify(fs.docs.get("places/p2"))).not.toContain("admin-uid-1");
});
