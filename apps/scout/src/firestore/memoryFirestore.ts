import {
  FirestoreClient,
  type FirestoreValue,
  fromFirestoreDocument,
  toFirestoreValue,
} from "@wayfare/firestore";
import type { FetchLike } from "@wayfare/providers";

const DOC_PREFIX = "/v1/projects/p/databases/(default)/documents/";
const DOC_NAME_PREFIX = "projects/p/databases/(default)/documents/";

export interface MemoryFirestore {
  client: FirestoreClient;
  updateBatches: number[];
  readonly patchCount: number;
  seed(path: string, data: Record<string, unknown>): void;
  failOn(path: string): void;
}

/** In-memory Firestore REST double. No sockets. */
export function createMemoryFirestore(): MemoryFirestore {
  const docs = new Map<string, Record<string, unknown>>();
  const updateBatches: number[] = [];
  let patchCount = 0;
  let failPath: string | undefined;

  const fetchImpl: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(":commit")) return commit(String(init?.body ?? ""));
    if (parsed.pathname.endsWith(":runQuery")) return query(String(init?.body ?? ""));
    const path = decodeURIComponent(parsed.pathname.slice(DOC_PREFIX.length));
    if (init?.method === "PATCH") return patch(path, parsed, String(init.body ?? ""));
    if (init?.method === "DELETE") {
      const existed = docs.delete(path);
      return new Response("{}", { status: existed ? 200 : 404 });
    }
    const doc = docs.get(path);
    if (doc === undefined) return new Response("{}", { status: 404 });
    return json({ name: path, fields: encodeFields(doc) });
  };

  function commit(raw: string): Response {
    const body = asRecord(JSON.parse(raw));
    const writes = Array.isArray(body?.writes) ? body.writes : [];
    const updates = writes.flatMap((write) => {
      const row = asRecord(write);
      const update = asRecord(row?.update);
      if (update === undefined) return [];
      const name = typeof update.name === "string" ? update.name : "";
      const docPath = name.split("/documents/")[1] ?? "";
      return [{ docPath, update, mask: asRecord(row?.updateMask) }];
    });
    if (failPath !== undefined && updates.some((item) => item.docPath === failPath)) {
      return new Response("{}", { status: 500 });
    }
    if (updates.length === writes.length && updates.length > 0) updateBatches.push(updates.length);
    for (const item of updates) {
      const incoming = fromFirestoreDocument({
        fields: (item.update.fields ?? {}) as Record<string, FirestoreValue>,
      });
      const mask = stringList(item.mask?.fieldPaths) ?? Object.keys(incoming);
      const current = docs.get(item.docPath) ?? {};
      docs.set(item.docPath, applyMask(current, incoming, mask));
    }
    for (const write of writes) {
      const row = asRecord(write);
      const transform = asRecord(row?.transform);
      if (transform === undefined) continue;
      const name = typeof transform.document === "string" ? transform.document : "";
      const docPath = name.split("/documents/")[1] ?? "";
      const current = docs.get(docPath) ?? {};
      const transforms = Array.isArray(transform.fieldTransforms) ? transform.fieldTransforms : [];
      for (const item of transforms) {
        const field = asRecord(item);
        const fieldPath = unquote(typeof field?.fieldPath === "string" ? field.fieldPath : "");
        const increment = asRecord(field?.increment);
        const delta = Number(increment?.integerValue ?? increment?.doubleValue ?? 0);
        current[fieldPath] = Number(current[fieldPath] ?? 0) + delta;
      }
      docs.set(docPath, current);
    }
    return json({});
  }

  function query(raw: string): Response {
    const body = asRecord(JSON.parse(raw));
    const structured = asRecord(body?.structuredQuery);
    const from = Array.isArray(structured?.from) ? asRecord(structured.from[0]) : undefined;
    const collectionId = typeof from?.collectionId === "string" ? from.collectionId : "";
    const filter = asRecord(asRecord(structured?.where)?.fieldFilter);
    const field = asRecord(filter?.field);
    const fieldPath = typeof field?.fieldPath === "string" ? field.fieldPath : "";
    const expected = asRecord(filter?.value)?.stringValue;
    const limit = typeof structured?.limit === "number" ? structured.limit : 300;
    const matches = [...docs.entries()]
      .filter(([path, data]) => {
        const parts = path.split("/");
        return parts.length === 2 && parts[0] === collectionId && data[fieldPath] === expected;
      })
      .sort(([left], [right]) => left.localeCompare(right));
    let start = 0;
    const startAt = asRecord(structured?.startAt);
    if (startAt?.before === false) {
      const values = Array.isArray(startAt.values) ? startAt.values : [];
      const cursor = asRecord(values[0])?.referenceValue;
      const cursorPath = typeof cursor === "string" ? cursor.slice(DOC_NAME_PREFIX.length) : "";
      const index = matches.findIndex(([path]) => path === cursorPath);
      start = index >= 0 ? index + 1 : 0;
    }
    const page = matches.slice(start, start + limit);
    if (page.length === 0) return json([{ readTime: "2026-09-22T12:00:00.000Z" }]);
    return json(
      page.map(([path, data]) => ({
        document: { name: `${DOC_NAME_PREFIX}${path}`, fields: encodeFields(data) },
      })),
    );
  }

  function patch(path: string, url: URL, raw: string): Response {
    if (failPath !== undefined && path === failPath) return new Response("{}", { status: 500 });
    const body = asRecord(JSON.parse(raw));
    const incoming = fromFirestoreDocument({
      fields: (body?.fields ?? {}) as Record<string, FirestoreValue>,
    });
    const mask = url.searchParams.getAll("updateMask.fieldPaths");
    const current = docs.get(path) ?? {};
    docs.set(path, applyMask(current, incoming, mask.length > 0 ? mask : Object.keys(incoming)));
    patchCount += 1;
    return json({});
  }

  return {
    client: new FirestoreClient({
      projectId: "p",
      tokenProvider: async () => "token",
      fetchImpl,
    }),
    updateBatches,
    get patchCount() {
      return patchCount;
    },
    seed(path, data) {
      docs.set(path, structuredClone(data));
    },
    failOn(path) {
      failPath = path;
    },
  };
}

function encodeFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  const encoded = toFirestoreValue(data);
  if (!("mapValue" in encoded)) return {};
  return encoded.mapValue.fields ?? {};
}

function applyMask(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mask: readonly string[],
): Record<string, unknown> {
  const next = { ...current };
  for (const field of mask) {
    if (Object.hasOwn(incoming, field)) next[field] = incoming[field];
    else delete next[field];
  }
  return next;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

function unquote(path: string): string {
  if (path.startsWith("`") && path.endsWith("`")) return path.slice(1, -1);
  return path;
}
