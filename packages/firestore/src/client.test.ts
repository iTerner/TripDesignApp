import { FirestoreClient } from "./client";
import { fromFirestoreDocument, toFirestoreValue } from "./values";

test("value codec round-trips strings, numbers, booleans, nested maps, arrays, null", () => {
  const v = { a: "x", n: 3, f: 1.5, b: true, z: null, m: { k: [1, "two", null] } };
  const enc = toFirestoreValue(v) as { mapValue: { fields: Record<string, never> } };
  expect(fromFirestoreDocument({ fields: enc.mapValue.fields })).toEqual(v);
});

function recorder(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init === undefined) calls.push({ url });
    else calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return {
    calls,
    client: new FirestoreClient({ projectId: "p", tokenProvider: async () => "TOKEN", fetchImpl }),
  };
}

test("getDocument returns null on 404 and decoded fields on 200, with bearer token", async () => {
  const { calls, client } = recorder([
    { status: 404, body: {} },
    { status: 200, body: { name: "x", fields: { tier: { stringValue: "free" } } } },
  ]);
  expect(await client.getDocument("users/u1")).toBeNull();
  expect(await client.getDocument("users/u1")).toEqual({ tier: "free" });
  expect(calls[0]?.url).toBe(
    "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users/u1",
  );
  expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer TOKEN");
});

test("patchDocument sends updateMask and precondition", async () => {
  const { calls, client } = recorder([{ status: 200, body: {} }]);
  await client.patchDocument(
    "users/u1",
    { lastActiveDate: "2026-09-20" },
    { updateMask: ["lastActiveDate"], mustExist: true },
  );
  const url = new URL(calls[0]?.url ?? "");
  expect(calls[0]?.init?.method).toBe("PATCH");
  expect(url.searchParams.getAll("updateMask.fieldPaths")).toEqual(["lastActiveDate"]);
  expect(url.searchParams.get("currentDocument.exists")).toBe("true");
});

test("incrementFields uses :commit with integer/double transforms", async () => {
  const { calls, client } = recorder([{ status: 200, body: {} }]);
  await client.incrementFields("metrics/global", { totalUsers: 1, ratio: 0.5 });
  expect(calls[0]?.url).toBe(
    "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:commit",
  );
  const body = JSON.parse(String(calls[0]?.init?.body));
  expect(body.writes[0].transform.document).toBe(
    "projects/p/databases/(default)/documents/metrics/global",
  );
  expect(body.writes[0].transform.fieldTransforms).toEqual([
    { fieldPath: "totalUsers", increment: { integerValue: "1" } },
    { fieldPath: "ratio", increment: { doubleValue: 0.5 } },
  ]);
});

test("incrementFields quotes model ids so dots and colons stay one field", async () => {
  const { calls, client } = recorder([{ status: 200, body: {} }]);
  await client.incrementFields("usageDaily/google_2026-09-21", {
    "google:gemini-3.8-flash.ok": 1,
    total: 1,
  });
  const body = JSON.parse(String(calls[0]?.init?.body));
  expect(body.writes[0].transform.fieldTransforms).toEqual([
    { fieldPath: "`google:gemini-3.8-flash.ok`", increment: { integerValue: "1" } },
    { fieldPath: "total", increment: { integerValue: "1" } },
  ]);
});

test("commitUpdates sends an update mask and refuses more than 500 writes before any request", async () => {
  const { calls, client } = recorder([{ status: 200, body: {} }]);
  await client.commitUpdates([
    {
      path: "destinations/tuscany",
      fields: { status: "ready" },
      updateMask: ["status", "lock"],
    },
  ]);
  const body = JSON.parse(String(calls[0]?.init?.body));
  expect(calls[0]?.url).toContain(":commit");
  expect(body.writes[0].update.name).toBe(
    "projects/p/databases/(default)/documents/destinations/tuscany",
  );
  expect(body.writes[0].updateMask.fieldPaths).toEqual(["status", "lock"]);
  expect(body.writes[0].update.fields.lock).toBeUndefined();
  expect(body.writes[0].update.fields.status).toEqual({ stringValue: "ready" });

  const blocked = recorder([]);
  const writes = Array.from({ length: 501 }, (_, index) => ({
    path: `places/p${index}`,
    fields: { name: "x" },
  }));
  await expect(blocked.client.commitUpdates(writes)).rejects.toThrow(/500/);
  expect(blocked.calls).toHaveLength(0);
});

test("queryEquals decodes matches and follows an exclusive name cursor", async () => {
  const docs = [
    { path: "places/a", destSlug: "tuscany", name: "A" },
    { path: "places/b", destSlug: "tuscany", name: "B" },
  ];
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      structuredQuery: {
        limit: number;
        startAt?: { before: boolean; values: Array<{ referenceValue: string }> };
      };
    };
    const ordered = [...docs].sort((left, right) => left.path.localeCompare(right.path));
    const cursor = body.structuredQuery.startAt;
    let start = 0;
    if (cursor?.before === false) {
      const reference = cursor.values[0]?.referenceValue ?? "";
      const index = ordered.findIndex((doc) => reference.endsWith(doc.path));
      start = index >= 0 ? index + 1 : 0;
    }
    const page = ordered.slice(start, start + body.structuredQuery.limit);
    return new Response(
      JSON.stringify(
        page.map((doc) => ({
          document: {
            name: `projects/p/databases/(default)/documents/${doc.path}`,
            fields: {
              destSlug: { stringValue: doc.destSlug },
              name: { stringValue: doc.name },
            },
          },
        })),
      ),
      { status: 200 },
    );
  };
  const client = new FirestoreClient({
    projectId: "p",
    tokenProvider: async () => "token",
    fetchImpl,
  });
  await expect(client.queryEquals("places", "destSlug", "tuscany", 1)).resolves.toEqual([
    { path: "places/a", data: { destSlug: "tuscany", name: "A" } },
    { path: "places/b", data: { destSlug: "tuscany", name: "B" } },
  ]);
});

test("non-2xx (other than 404 on GET) throws with the status and not the upstream body", async () => {
  const { client } = recorder([
    { status: 403, body: { error: { message: "user@example.com bearer leaked" } } },
  ]);
  await expect(client.getDocument("users/u1")).rejects.toThrow("Firestore HTTP 403");
});
