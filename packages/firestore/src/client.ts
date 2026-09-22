import type { FetchLike } from "@wayfare/providers";
import { type FirestoreValue, fromFirestoreDocument, toFirestoreValue } from "./values";

/** Firestore rejects unquoted paths that contain `:`, `.`, or `/` (model ids). Quote the whole name so `.` stays inside the field. */
function quoteFieldPath(path: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return path;
  return `\`${path.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

export interface FirestoreClientOptions {
  projectId: string;
  tokenProvider: () => Promise<string>;
  fetchImpl: FetchLike;
  /** Defaults to https://firestore.googleapis.com; dev.bat points it at the emulator (http://127.0.0.1:8080). */
  host?: string;
}

export class FirestoreClient {
  private readonly docRoot: string;
  private readonly apiRoot: string;
  private readonly base: string;

  constructor(private readonly opts: FirestoreClientOptions) {
    this.docRoot = `projects/${opts.projectId}/databases/(default)/documents`;
    this.apiRoot = `${opts.host ?? "https://firestore.googleapis.com"}/v1`;
    this.base = `${this.apiRoot}/${this.docRoot}`;
  }

  private async call(url: string, init: RequestInit = {}, allow404 = false): Promise<Response> {
    const token = await this.opts.tokenProvider();
    const res = await this.opts.fetchImpl(url, {
      ...init,
      headers: {
        ...((init.headers as Record<string, string> | undefined) ?? {}),
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    if (!res.ok && !(allow404 && res.status === 404)) {
      await res.body?.cancel();
      throw new Error(`Firestore HTTP ${res.status}`);
    }
    return res;
  }

  async getDocument(path: string): Promise<Record<string, unknown> | null> {
    const res = await this.call(`${this.base}/${path}`, {}, true);
    if (res.status === 404) return null;
    return fromFirestoreDocument((await res.json()) as { fields?: Record<string, FirestoreValue> });
  }

  /** DELETE. A missing document is success. */
  async deleteDocument(path: string): Promise<void> {
    const res = await this.call(`${this.base}/${path}`, { method: "DELETE" }, true);
    await res.body?.cancel().catch(() => undefined);
  }

  /** PATCH with updateMask = upsert (creates the doc if missing unless mustExist). */
  async patchDocument(
    path: string,
    fields: Record<string, unknown>,
    opts: { updateMask?: string[]; mustExist?: boolean; mustNotExist?: boolean } = {},
  ): Promise<void> {
    const url = new URL(`${this.base}/${path}`);
    for (const f of opts.updateMask ?? Object.keys(fields)) {
      url.searchParams.append("updateMask.fieldPaths", f);
    }
    if (opts.mustExist) url.searchParams.set("currentDocument.exists", "true");
    if (opts.mustNotExist) url.searchParams.set("currentDocument.exists", "false");
    const encoded = toFirestoreValue(fields) as {
      mapValue: { fields: Record<string, FirestoreValue> };
    };
    await this.call(url.toString(), {
      method: "PATCH",
      body: JSON.stringify({ fields: encoded.mapValue.fields }),
    });
  }

  /** Atomic numeric increments via :commit; creates the document if it does not exist. */
  async incrementFields(path: string, increments: Record<string, number>): Promise<void> {
    const fieldTransforms = Object.entries(increments).map(([fieldPath, n]) => ({
      fieldPath: quoteFieldPath(fieldPath),
      increment: Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n },
    }));
    await this.call(`${this.apiRoot}/${this.docRoot}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: [{ transform: { document: `${this.docRoot}/${path}`, fieldTransforms } }],
      }),
    });
  }

  /** One Firestore commit. More than 500 writes is rejected before the request. */
  async commitUpdates(
    writes: ReadonlyArray<{
      path: string;
      fields: Record<string, unknown>;
      updateMask?: readonly string[];
    }>,
  ): Promise<void> {
    if (writes.length === 0) return;
    if (writes.length > 500) throw new Error("Firestore commit exceeds 500 writes");
    await this.call(`${this.apiRoot}/${this.docRoot}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: writes.map((write) => {
          const encoded = toFirestoreValue(write.fields) as {
            mapValue: { fields: Record<string, FirestoreValue> };
          };
          return {
            update: {
              name: `${this.docRoot}/${write.path}`,
              fields: encoded.mapValue.fields,
            },
            updateMask: { fieldPaths: [...(write.updateMask ?? Object.keys(write.fields))] },
          };
        }),
      }),
    });
  }

  /** Equality query on one collection. Pages of `pageSize` follow the document-name cursor. */
  async queryEquals(
    collectionId: string,
    fieldPath: string,
    value: string,
    pageSize = 300,
  ): Promise<Array<{ path: string; data: Record<string, unknown> }>> {
    const out: Array<{ path: string; data: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: "EQUAL",
            value: { stringValue: value },
          },
        },
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        limit: pageSize,
      };
      if (cursor !== undefined) {
        structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
      }
      const res = await this.call(`${this.apiRoot}/${this.docRoot}:runQuery`, {
        method: "POST",
        body: JSON.stringify({ structuredQuery }),
      });
      const rows = parseQueryRows(await res.text());
      let count = 0;
      for (const row of rows) {
        const document = queryDocument(row);
        if (document === undefined) continue;
        const path = document.name.split("/documents/")[1];
        if (path === undefined || seen.has(path)) return out;
        seen.add(path);
        count += 1;
        cursor = document.name;
        out.push({ path, data: fromFirestoreDocument({ fields: document.fields }) });
      }
      if (count < pageSize) return out;
    }
    throw new Error("Firestore query exceeded 20 pages");
  }
}

function parseQueryRows(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }
  const rows: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const item = line.trim();
    if (item.length === 0) continue;
    rows.push(JSON.parse(item) as unknown);
  }
  return rows;
}

function queryDocument(
  row: unknown,
): { name: string; fields: Record<string, FirestoreValue> } | undefined {
  if (typeof row !== "object" || row === null || !("document" in row)) return undefined;
  const document = (row as { document?: unknown }).document;
  if (typeof document !== "object" || document === null) return undefined;
  const name = (document as { name?: unknown }).name;
  if (typeof name !== "string") return undefined;
  const fields = (document as { fields?: unknown }).fields ?? {};
  if (typeof fields !== "object" || fields === null) return undefined;
  return { name, fields: fields as Record<string, FirestoreValue> };
}
