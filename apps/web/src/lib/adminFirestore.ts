import {
  DestinationGeometrySchema,
  DestinationSchema,
  type Evidence,
  EvidenceSchema,
  type PendingMerge,
  PendingMergeSchema,
  type Place,
  PlaceSchema,
  type ReviewSession,
  ReviewSessionSchema,
  type ScoutRun,
  ScoutRunSchema,
} from "@wayfare/domain";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import type { z } from "zod";
import { db } from "./firebase";
import { type PlaceFilters, placeMatches } from "./placeFilters";

export type { PlaceFilters };
export type DestinationRead = z.infer<typeof DestinationReadSchema>;
export type PlaceSort = "fame" | "trend" | "updated";

export interface PlacePage {
  places: Place[];
  nextCursor: string | null;
}

/** Admin tables read at most this many documents per Firestore request. */
export const PAGE_SIZE = 50;

const DestinationReadSchema = DestinationSchema.omit({ geometry: true }).extend({
  geometry: DestinationGeometrySchema.optional(),
});

const SORT_FIELD = {
  fame: "fameScore",
  trend: "trendScore",
  // "Updated" sorts by firstSeenAt, the timestamp stored on each place.
  updated: "firstSeenAt",
} as const;

const placeCursors = new Map<string, QueryDocumentSnapshot>();
let placeCursorSeq = 0;

function parseDoc<T>(schema: z.ZodType<T>, id: string, data: unknown, idField: string): T | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const parsed = schema.safeParse({ ...record, [idField]: id });
  return parsed.success ? parsed.data : null;
}

export async function listDestinations(): Promise<DestinationRead[]> {
  const snap = await getDocs(
    query(collection(db, "destinations"), orderBy("queueOrder", "asc"), limit(PAGE_SIZE)),
  );
  const rows: DestinationRead[] = [];
  for (const item of snap.docs) {
    const row = parseDoc(DestinationReadSchema, item.id, item.data(), "slug");
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => a.queueOrder - b.queueOrder);
}

export async function listScoutRuns(destSlug: string): Promise<ScoutRun[]> {
  const snap = await getDocs(
    query(collection(db, "scoutRuns"), where("destSlug", "==", destSlug), limit(PAGE_SIZE)),
  );
  const rows: ScoutRun[] = [];
  for (const item of snap.docs) {
    const row = parseDoc(ScoutRunSchema, item.id, item.data(), "runId");
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

export async function listPlaces(
  filters: PlaceFilters,
  sort: PlaceSort,
  after?: string,
): Promise<PlacePage> {
  const field = SORT_FIELD[sort];
  let scanAfter = after ? placeCursors.get(after) : undefined;
  const places: Place[] = [];
  let exhausted = false;

  for (let round = 0; round < 20 && places.length < PAGE_SIZE; round += 1) {
    const constraints: QueryConstraint[] = [orderBy(field, "desc"), limit(PAGE_SIZE)];
    if (scanAfter) constraints.splice(1, 0, startAfter(scanAfter));
    const snap = await getDocs(query(collection(db, "places"), ...constraints));
    if (snap.empty) {
      exhausted = true;
      break;
    }
    let seen = 0;
    for (const item of snap.docs) {
      seen += 1;
      scanAfter = item;
      const place = parseDoc(PlaceSchema, item.id, item.data(), "id");
      if (place && placeMatches(place, filters)) places.push(place);
      if (places.length === PAGE_SIZE) break;
    }
    if (seen === snap.docs.length && snap.size < PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  let nextCursor: string | null = null;
  if (!exhausted && scanAfter) {
    const token = `places-${placeCursorSeq}`;
    placeCursorSeq += 1;
    placeCursors.set(token, scanAfter);
    nextCursor = token;
  }
  return { places, nextCursor };
}

export async function listEvidence(placeId: string): Promise<Evidence[]> {
  const snap = await getDocs(
    query(collection(db, "places", placeId, "evidence"), limit(PAGE_SIZE)),
  );
  const rows: Evidence[] = [];
  for (const item of snap.docs) {
    const row = parseDoc(EvidenceSchema, item.id, item.data(), "id");
    if (row) rows.push(row);
  }
  return rows;
}

export async function listOpenMerges(): Promise<PendingMerge[]> {
  const snap = await getDocs(
    query(collection(db, "pendingMerges"), where("status", "==", "open"), limit(PAGE_SIZE)),
  );
  const rows: PendingMerge[] = [];
  for (const item of snap.docs) {
    const row = parseDoc(PendingMergeSchema, item.id, item.data(), "id");
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => b.score - a.score);
}

export async function getPlace(id: string): Promise<Place | null> {
  const snap = await getDoc(doc(db, "places", id));
  if (!snap.exists()) return null;
  return parseDoc(PlaceSchema, snap.id, snap.data(), "id");
}

export async function getReviewSession(id: string): Promise<ReviewSession | null> {
  const snap = await getDoc(doc(db, "reviewSessions", id));
  if (!snap.exists()) return null;
  return parseDoc(ReviewSessionSchema, snap.id, snap.data(), "id");
}
