/** Minimal in-memory Firestore REST fake: GET document, PATCH (upsert), :commit increments, plus the OAuth token endpoint. */
export function fakeFirestore(projectId = "test-project") {
  const docs = new Map<string, Record<string, unknown>>();
  const prefix = `/v1/projects/${projectId}/databases/(default)/documents/`;

  const encode = (v: unknown) =>
    typeof v === "string"
      ? { stringValue: v }
      : typeof v === "boolean"
        ? { booleanValue: v }
        : Number.isInteger(v)
          ? { integerValue: String(v) }
          : { doubleValue: v as number };

  const decode = (v: Record<string, unknown>): unknown =>
    "stringValue" in v
      ? v.stringValue
      : "booleanValue" in v
        ? v.booleanValue
        : "integerValue" in v
          ? Number(v.integerValue)
          : "doubleValue" in v
            ? v.doubleValue
            : null;

  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 });
    }
    const u = new URL(url);
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
          cur[t.fieldPath] =
            Number(cur[t.fieldPath] ?? 0) +
            Number(t.increment.integerValue ?? t.increment.doubleValue ?? 0);
        }
        docs.set(path, cur);
      }
      return new Response("{}", { status: 200 });
    }
    const path = u.pathname.slice(prefix.length);
    if (init?.method === "PATCH") {
      if (u.searchParams.get("currentDocument.exists") === "true" && !docs.has(path)) {
        return new Response("{}", { status: 404 });
      }
      const body = JSON.parse(String(init.body)) as {
        fields: Record<string, Record<string, unknown>>;
      };
      const cur = docs.get(path) ?? {};
      for (const [k, v] of Object.entries(body.fields)) cur[k] = decode(v);
      docs.set(path, cur);
      return new Response("{}", { status: 200 });
    }
    const doc = docs.get(path);
    if (!doc) return new Response("{}", { status: 404 });
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) fields[k] = encode(v);
    return new Response(JSON.stringify({ name: path, fields }), { status: 200 });
  };
  return { docs, fetchImpl };
}
