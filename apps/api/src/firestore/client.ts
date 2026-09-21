import type { FetchLike } from "@wayfare/providers";

/** Firestore rejects unquoted paths that contain `:`, `.`, or `/` (model ids). Quote the whole name so `.` stays inside the field. */
function quoteFieldPath(path: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return path;
  return `\`${path.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

import { type FirestoreValue, fromFirestoreDocument, toFirestoreValue } from "./values";

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
}
