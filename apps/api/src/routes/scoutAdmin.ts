import {
  CreateDestinationRequestSchema,
  type CreateDestinationResponse,
  CreateReviewRequestSchema,
  type CreateReviewResponse,
  type DeleteDestinationResponse,
  PlaceHideRequestSchema,
  type PlaceHideResponse,
  PlaceOverrideRequestSchema,
  type PlaceOverrideResponse,
  PlaceSchema,
  ReorderDestinationsRequestSchema,
  type ReorderDestinationsResponse,
  ResolveMergeRequestSchema,
  type ResolveMergeResponse,
  ReviewVerdictRequestSchema,
  type ReviewVerdictResponse,
} from "@wayfare/domain";
import {
  type FirestoreValue,
  fromFirestoreDocument,
  getAccessToken,
  parseServiceAccount,
} from "@wayfare/firestore";
import type { FetchLike } from "@wayfare/providers";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import type { Env } from "../env";
import { dispatchScout, GithubDispatchError } from "../github/dispatch";
import { apiError } from "../http/errors";
import { firestoreFor } from "./ping";

const SLUG = /^[a-z0-9-]{2,64}$/;
const RunScoutRequestSchema = z.strictObject({
  slug: z.string().regex(SLUG),
});
const DOC_ID = /^[A-Za-z0-9_-]{1,200}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BLOCKED_OVERRIDE_FIELDS = new Set([
  "id",
  "destSlug",
  "status",
  "adminOverrides",
  "mergedInto",
]);
const PAGE_SIZE = 300;

interface ListedDoc {
  id: string;
  data: Record<string, unknown>;
}

interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

function badRequest(c: Context<AppEnv>): Response {
  return apiError(c, 400, "bad_request", "Invalid request");
}

function firestoreStatus(e: unknown): number | null {
  if (!(e instanceof Error)) return null;
  const match = /^Firestore HTTP (\d+)$/.exec(e.message);
  return match ? Number(match[1]) : null;
}

async function parseBody<T>(c: Context<AppEnv>, schema: Parser<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return badRequest(c);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return badRequest(c);
  return parsed.data;
}

function firestoreRoot(env: Env): string {
  const host = env.FIRESTORE_EMULATOR_HOST
    ? `http://${env.FIRESTORE_EMULATOR_HOST}`
    : "https://firestore.googleapis.com";
  return `${host}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function bearer(env: Env, fetchImpl: FetchLike, now: () => Date): Promise<string> {
  if (env.FIRESTORE_EMULATOR_HOST) return "owner";
  return getAccessToken(
    parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT),
    env.CONFIG_KV,
    fetchImpl,
    now(),
  );
}

function dbFor(c: Context<AppEnv>) {
  const env = c.env;
  const { fetchImpl, now } = c.get("deps");
  const client = firestoreFor(env, fetchImpl, now);
  const root = firestoreRoot(env);

  const call = async (pathWithQuery: string, init?: RequestInit): Promise<Response> => {
    const token = await bearer(env, fetchImpl, now);
    return fetchImpl(`${root}/${pathWithQuery}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
  };

  const list = async (collectionPath: string): Promise<ListedDoc[]> => {
    const out: ListedDoc[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const q = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
      if (pageToken) q.set("pageToken", pageToken);
      const res = await call(`${collectionPath}?${q.toString()}`);
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`Firestore HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        documents?: Array<{ name: string; fields?: Record<string, FirestoreValue> }>;
        nextPageToken?: string;
      };
      for (const doc of json.documents ?? []) {
        const full = doc.name.split("/documents/")[1];
        if (!full?.startsWith(`${collectionPath}/`)) continue;
        const id = full.slice(collectionPath.length + 1);
        if (!id || id.includes("/")) continue;
        out.push({ id, data: fromFirestoreDocument(doc) });
      }
      const next = json.nextPageToken;
      if (!next || seen.has(next)) break;
      seen.add(next);
      pageToken = next;
    }
    return out;
  };

  const remove = async (path: string): Promise<void> => {
    const res = await call(path, { method: "DELETE" });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Firestore HTTP ${res.status}`);
    }
    await res.body?.cancel();
  };

  return { client, list, remove };
}

function queueOrderOf(data: Record<string, unknown>): number | null {
  const n = data.queueOrder;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

function asSources(v: unknown): Array<{ kind: string; ref: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ kind: string; ref: string }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.kind === "string" && typeof rec.ref === "string") {
      out.push({ kind: rec.kind, ref: rec.ref });
    }
  }
  return out;
}

function unionSources(
  winner: Array<{ kind: string; ref: string }>,
  loser: Array<{ kind: string; ref: string }>,
): Array<{ kind: string; ref: string }> {
  const seen = new Set<string>();
  const out: Array<{ kind: string; ref: string }> = [];
  for (const source of [...winner, ...loser]) {
    const key = `${source.kind}\0${source.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string");
}

function samplePlaceIds(sample: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(sample)) return ids;
  for (const item of sample) {
    if (!item || typeof item !== "object") continue;
    const placeId = (item as Record<string, unknown>).placeId;
    if (typeof placeId === "string") ids.add(placeId);
  }
  return ids;
}

function asVerdicts(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const left = out[i];
    const right = out[j];
    if (left === undefined || right === undefined) continue;
    out[i] = right;
    out[j] = left;
  }
  return out;
}

function trendScore(data: Record<string, unknown>): number {
  return typeof data.trendScore === "number" ? data.trendScore : 0;
}

async function writeAudit(
  c: Context<AppEnv>,
  db: ReturnType<typeof dbFor>,
  action: string,
  target: string,
): Promise<void> {
  const id = `aud_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.client.patchDocument(`auditLog/${id}`, {
    action,
    target,
    actorUid: c.get("user").uid,
    at: c.get("deps").now().toISOString(),
  });
}

function activeForRun(doc: ListedDoc, destSlug: string, runId: string): boolean {
  const data = doc.data;
  return (
    data.destSlug === destSlug &&
    data.status === "active" &&
    (data.runId === runId || data.lastSeenRunId === runId)
  );
}

export const scoutAdminRoutes = new Hono<AppEnv>();

scoutAdminRoutes.post("/destinations", async (c) => {
  const body = await parseBody(c, CreateDestinationRequestSchema);
  if (body instanceof Response) return body;
  const db = dbFor(c);
  const path = `destinations/${body.slug}`;
  if (await db.client.getDocument(path)) {
    return apiError(c, 409, "conflict", "Destination already exists");
  }
  let maxOrder = -1;
  for (const doc of await db.list("destinations")) {
    const order = queueOrderOf(doc.data);
    if (order !== null && order > maxOrder) maxOrder = order;
  }
  const queueOrder = maxOrder + 1;
  const fields: Record<string, unknown> = {
    slug: body.slug,
    name: body.name,
    kind: body.kind,
    queueOrder,
    status: "queued",
    requestedBy: "admin",
    counts: { scouted: 0, userFound: 0, trending: 0, hidden: 0 },
  };
  if (body.geometry !== undefined) fields.geometry = body.geometry;
  if (body.hints !== undefined) fields.hints = body.hints;
  try {
    await db.client.patchDocument(path, fields, { mustNotExist: true });
  } catch (e) {
    if (firestoreStatus(e) === 409)
      return apiError(c, 409, "conflict", "Destination already exists");
    throw e;
  }
  const response: CreateDestinationResponse = {
    ok: true,
    slug: body.slug,
    status: "queued",
    queueOrder,
  };
  await writeAudit(c, db, "destination.create", `destinations/${body.slug}`);
  return c.json(response);
});

scoutAdminRoutes.post("/destinations/reorder", async (c) => {
  const body = await parseBody(c, ReorderDestinationsRequestSchema);
  if (body instanceof Response) return body;
  const db = dbFor(c);
  for (const slug of body.slugs) {
    if (!(await db.client.getDocument(`destinations/${slug}`))) {
      return apiError(c, 404, "not_found", "Destination not found");
    }
  }
  const order = body.slugs.map((slug, queueOrder) => ({ slug, queueOrder }));
  for (const item of order) {
    await db.client.patchDocument(
      `destinations/${item.slug}`,
      { queueOrder: item.queueOrder },
      { updateMask: ["queueOrder"], mustExist: true },
    );
  }
  const response: ReorderDestinationsResponse = { ok: true, order };
  await writeAudit(c, db, "destination.reorder", "destinations");
  return c.json(response);
});

scoutAdminRoutes.delete("/destinations/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG.test(slug)) return badRequest(c);
  const db = dbFor(c);
  const dest = await db.client.getDocument(`destinations/${slug}`);
  if (!dest) return apiError(c, 404, "not_found", "Destination not found");
  if (dest.status !== "queued") {
    return apiError(c, 409, "conflict", "Only queued destinations can be deleted");
  }
  const places = await db.list("places");
  if (places.some((place) => place.data.destSlug === slug)) {
    return apiError(c, 409, "conflict", "Destination still has places");
  }
  await db.remove(`destinations/${slug}`);
  const response: DeleteDestinationResponse = { ok: true, slug };
  await writeAudit(c, db, "destination.delete", `destinations/${slug}`);
  return c.json(response);
});

scoutAdminRoutes.post("/run", async (c) => {
  const body = await parseBody(c, RunScoutRequestSchema);
  if (body instanceof Response) return body;
  const token = (c.env.GITHUB_DISPATCH_TOKEN ?? "").trim();
  if (token === "") {
    return apiError(c, 503, "upstream_exhausted", "GitHub dispatch is not configured");
  }
  try {
    await dispatchScout({
      token,
      repo: "iTerner/TripDesignApp",
      slug: body.slug,
      fetchImpl: c.get("deps").fetchImpl,
    });
  } catch (e) {
    if (e instanceof GithubDispatchError) return apiError(c, 503, e.code, e.message);
    throw e;
  }
  await writeAudit(c, dbFor(c), "scout.run", `destinations/${body.slug}`);
  return c.json({ ok: true, slug: body.slug });
});

export const placeAdminRoutes = new Hono<AppEnv>();

placeAdminRoutes.post("/:id/overrides", async (c) => {
  const id = c.req.param("id");
  if (!DOC_ID.test(id)) return badRequest(c);
  const body = await parseBody(c, PlaceOverrideRequestSchema);
  if (body instanceof Response) return body;
  if (
    BLOCKED_OVERRIDE_FIELDS.has(body.field) ||
    !FIELD.test(body.field) ||
    !(body.field in PlaceSchema.shape)
  ) {
    return badRequest(c);
  }
  const fieldSchema = PlaceSchema.shape[body.field as keyof typeof PlaceSchema.shape];
  const checked = fieldSchema.safeParse(body.value);
  if (!checked.success) return badRequest(c);
  const db = dbFor(c);
  if (!(await db.client.getDocument(`places/${id}`))) {
    return apiError(c, 404, "not_found", "Place not found");
  }
  const at = c.get("deps").now().toISOString();
  await db.client.patchDocument(
    `places/${id}`,
    { adminOverrides: { [body.field]: { value: checked.data, by: "admin", at } } },
    { updateMask: [`adminOverrides.${body.field}`], mustExist: true },
  );
  if (body.note !== undefined) {
    await db.client.patchDocument(
      `places/${id}/private/admin`,
      { notes: { [body.field]: body.note } },
      { updateMask: [`notes.${body.field}`] },
    );
  }
  const response: PlaceOverrideResponse = { ok: true, id, field: body.field };
  await writeAudit(c, db, "place.override", `places/${id}`);
  return c.json(response);
});

placeAdminRoutes.post("/:id/hide", async (c) => {
  const id = c.req.param("id");
  if (!DOC_ID.test(id)) return badRequest(c);
  const body = await parseBody(c, PlaceHideRequestSchema);
  if (body instanceof Response) return body;
  const db = dbFor(c);
  if (!(await db.client.getDocument(`places/${id}`))) {
    return apiError(c, 404, "not_found", "Place not found");
  }
  await db.client.patchDocument(
    `places/${id}`,
    { status: "hidden" },
    { updateMask: ["status"], mustExist: true },
  );
  await db.client.patchDocument(
    `places/${id}/private/admin`,
    { hideReason: body.reason },
    { updateMask: ["hideReason"] },
  );
  const response: PlaceHideResponse = { ok: true, id, status: "hidden" };
  await writeAudit(c, db, "place.hide", `places/${id}`);
  return c.json(response);
});

export const mergeAdminRoutes = new Hono<AppEnv>();

mergeAdminRoutes.post("/:id", async (c) => {
  const id = c.req.param("id");
  if (!DOC_ID.test(id)) return badRequest(c);
  const body = await parseBody(c, ResolveMergeRequestSchema);
  if (body instanceof Response) return body;
  const db = dbFor(c);
  const merge = await db.client.getDocument(`pendingMerges/${id}`);
  if (!merge) return apiError(c, 404, "not_found", "Merge not found");
  if (merge.status !== "open") return apiError(c, 409, "conflict", "Merge is already resolved");
  const now = c.get("deps").now().toISOString();
  if (body.action === "keep_both") {
    await db.client.patchDocument(
      `pendingMerges/${id}`,
      { status: "kept_both", resolvedBy: "admin", resolvedAt: now },
      { updateMask: ["status", "resolvedBy", "resolvedAt"], mustExist: true },
    );
    const response: ResolveMergeResponse = { ok: true, id, status: "kept_both" };
    await writeAudit(c, db, "merge.resolve", `pendingMerges/${id}`);
    return c.json(response);
  }

  const placeIdA = merge.placeIdA;
  const placeIdB = merge.placeIdB;
  if (typeof placeIdA !== "string" || typeof placeIdB !== "string" || placeIdA === placeIdB) {
    return apiError(c, 409, "conflict", "Merge places are invalid");
  }
  const winnerId = body.keep === "a" ? placeIdA : placeIdB;
  const loserId = body.keep === "a" ? placeIdB : placeIdA;
  if (!DOC_ID.test(winnerId) || !DOC_ID.test(loserId)) {
    return apiError(c, 409, "conflict", "Merge places are invalid");
  }
  const winner = await db.client.getDocument(`places/${winnerId}`);
  const loser = await db.client.getDocument(`places/${loserId}`);
  if (!winner || !loser) return apiError(c, 404, "not_found", "Place not found");

  const winnerEvidence = await db.list(`places/${winnerId}/evidence`);
  const have = new Set(winnerEvidence.map((doc) => doc.id));
  for (const evidence of await db.list(`places/${loserId}/evidence`)) {
    if (have.has(evidence.id) || !DOC_ID.test(evidence.id)) continue;
    await db.client.patchDocument(`places/${winnerId}/evidence/${evidence.id}`, {
      ...evidence.data,
      placeId: winnerId,
    });
  }

  const winnerName = typeof winner.name === "string" ? winner.name : "";
  const loserName = typeof loser.name === "string" ? loser.name : "";
  const aliases = asStrings(winner.aliases);
  const nextAliases =
    loserName && loserName !== winnerName && !aliases.includes(loserName)
      ? [...aliases, loserName]
      : aliases;
  await db.client.patchDocument(
    `places/${winnerId}`,
    {
      sources: unionSources(asSources(winner.sources), asSources(loser.sources)),
      aliases: nextAliases,
    },
    { updateMask: ["sources", "aliases"], mustExist: true },
  );
  await db.client.patchDocument(
    `places/${loserId}`,
    { status: "tombstoned", mergedInto: winnerId },
    { updateMask: ["status", "mergedInto"], mustExist: true },
  );
  await db.client.patchDocument(
    `pendingMerges/${id}`,
    { status: "merged", resolvedBy: "admin", resolvedAt: now },
    { updateMask: ["status", "resolvedBy", "resolvedAt"], mustExist: true },
  );
  const response: ResolveMergeResponse = { ok: true, id, status: "merged" };
  await writeAudit(c, db, "merge.resolve", `pendingMerges/${id}`);
  return c.json(response);
});

export const reviewAdminRoutes = new Hono<AppEnv>();

reviewAdminRoutes.post("/", async (c) => {
  const body = await parseBody(c, CreateReviewRequestSchema);
  if (body instanceof Response) return body;
  const db = dbFor(c);
  const now = c.get("deps").now();
  const active = (await db.list("places")).filter((doc) =>
    activeForRun(doc, body.destSlug, body.runId),
  );
  const ranked = [...active].sort((a, b) => {
    const delta = trendScore(b.data) - trendScore(a.data);
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const top = ranked.slice(0, 30);
  const random = shuffle(active, `${body.destSlug}\n${body.runId}\n${now.toISOString()}`).slice(
    0,
    30,
  );
  const sample = [
    ...random.map((doc) => ({ placeId: doc.id, bucket: "random" as const })),
    ...top.map((doc) => ({ placeId: doc.id, bucket: "topTrend" as const })),
  ];
  const id = `rev_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.client.patchDocument(
    `reviewSessions/${id}`,
    {
      id,
      destSlug: body.destSlug,
      runId: body.runId,
      sample,
      verdicts: {},
      accuracy: 0,
      startedAt: now.toISOString(),
    },
    { mustNotExist: true },
  );
  const response: CreateReviewResponse = { ok: true, id, sampleSize: sample.length };
  await writeAudit(c, db, "review.create", `reviewSessions/${id}`);
  return c.json(response);
});

reviewAdminRoutes.post("/:id/verdict", async (c) => {
  const id = c.req.param("id");
  if (!DOC_ID.test(id)) return badRequest(c);
  const body = await parseBody(c, ReviewVerdictRequestSchema);
  if (body instanceof Response) return body;
  if (!DOC_ID.test(body.placeId)) return badRequest(c);
  const db = dbFor(c);
  const session = await db.client.getDocument(`reviewSessions/${id}`);
  if (!session) return apiError(c, 404, "not_found", "Review not found");
  const ids = samplePlaceIds(session.sample);
  if (!ids.has(body.placeId)) return badRequest(c);
  if (!(await db.client.getDocument(`places/${body.placeId}`))) {
    return apiError(c, 404, "not_found", "Place not found");
  }

  const stored = body.verdict === "wrong" ? `wrong:${body.reason}` : body.verdict;
  if (body.verdict === "wrong") {
    await db.client.incrementFields(`places/${body.placeId}`, { timesFlagged: 1 });
  } else if (body.verdict === "hide") {
    await db.client.patchDocument(
      `places/${body.placeId}`,
      { status: "hidden" },
      { updateMask: ["status"], mustExist: true },
    );
    await db.client.patchDocument(
      `places/${body.placeId}/private/admin`,
      { hideReason: "review" },
      { updateMask: ["hideReason"] },
    );
  }

  const verdicts = asVerdicts(session.verdicts);
  verdicts[body.placeId] = stored;
  const recorded = Object.values(verdicts);
  const correct = recorded.filter((verdict) => verdict === "correct").length;
  const accuracy = recorded.length === 0 ? 0 : correct / recorded.length;
  const completed =
    ids.size > 0 && [...ids].every((placeId) => typeof verdicts[placeId] === "string");
  const now = c.get("deps").now().toISOString();
  const fields: Record<string, unknown> = { verdicts, accuracy };
  const updateMask = ["verdicts", "accuracy"];
  if (completed) {
    fields.completedAt = now;
    updateMask.push("completedAt");
  }
  await db.client.patchDocument(`reviewSessions/${id}`, fields, { updateMask, mustExist: true });
  const response: ReviewVerdictResponse = { ok: true, id, accuracy, completed };
  await writeAudit(c, db, "review.verdict", `reviewSessions/${id}`);
  return c.json(response);
});
