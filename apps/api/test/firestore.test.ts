import { FirestoreClient } from "../src/firestore/client";
import { fromFirestoreDocument, toFirestoreValue } from "../src/firestore/values";

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

test("non-2xx (other than 404 on GET) throws with the status", async () => {
  const { client } = recorder([{ status: 403, body: { error: { message: "denied" } } }]);
  await expect(client.getDocument("users/u1")).rejects.toThrow(/403/);
});
