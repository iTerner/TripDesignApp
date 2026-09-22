import {
  ApiErrorSchema,
  CreateDestinationRequestSchema,
  CreateDestinationResponseSchema,
  CreateReviewRequestSchema,
  CreateReviewResponseSchema,
  DeleteDestinationResponseSchema,
  PingResponseSchema,
  PlaceHideRequestSchema,
  PlaceHideResponseSchema,
  PlaceOverrideRequestSchema,
  PlaceOverrideResponseSchema,
  ReorderDestinationsRequestSchema,
  ReorderDestinationsResponseSchema,
  ResolveMergeRequestSchema,
  ResolveMergeResponseSchema,
  ReviewVerdictRequestSchema,
  ReviewVerdictResponseSchema,
} from "./contracts";

test("ping response shape", () => {
  const ok = PingResponseSchema.parse({
    ok: true,
    uid: "abc",
    serverTime: "2026-09-20T12:00:00.000Z",
    firstSeen: false,
  });
  expect(ok.uid).toBe("abc");
  expect(() => PingResponseSchema.parse({ ok: true })).toThrow();
});

test("api error shape", () => {
  expect(ApiErrorSchema.parse({ error: "unauthorized", message: "Missing token" }).error).toBe(
    "unauthorized",
  );
  expect(
    ApiErrorSchema.parse({ error: "conflict", message: "Destination still has places" }).error,
  ).toBe("conflict");
  expect(ApiErrorSchema.parse({ error: "not_implemented", message: "later" }).error).toBe(
    "not_implemented",
  );
  expect(() => ApiErrorSchema.parse({ error: "weird", message: "x" })).toThrow();
});

const geometry = {
  bbox: { south: 42.2, west: 9.6, north: 44.5, east: 12.4 },
  center: { lat: 43.4, lng: 11.1 },
};

test("create destination body is name, kind, and slug; the worker sets requestedBy", () => {
  const ok = CreateDestinationRequestSchema.parse({
    slug: "tuscany",
    name: "Tuscany",
    kind: "region",
    geometry,
    hints: ["chianti"],
  });
  expect(ok.kind).toBe("region");
  expect(ok.geometry?.center.lat).toBe(43.4);
  expect(
    CreateDestinationRequestSchema.parse({ slug: "rome", name: "Rome", kind: "city" }).geometry,
  ).toBeUndefined();
  expect(() =>
    CreateDestinationRequestSchema.parse({ slug: "Tuscany", name: "Tuscany", kind: "region" }),
  ).toThrow();
  expect(() =>
    CreateDestinationRequestSchema.parse({
      slug: "tuscany",
      name: "Tuscany",
      kind: "region",
      requestedBy: "uid-1",
    }),
  ).toThrow();
});

test("reorder body is an ordered slug list", () => {
  expect(ReorderDestinationsRequestSchema.parse({ slugs: ["rome", "tuscany"] }).slugs).toEqual([
    "rome",
    "tuscany",
  ]);
  expect(() => ReorderDestinationsRequestSchema.parse({ slugs: [] })).toThrow();
  expect(() => ReorderDestinationsRequestSchema.parse({ slugs: ["rome", "rome"] })).toThrow();
});

test("place override body has field and value, never by", () => {
  const ok = PlaceOverrideRequestSchema.parse({
    field: "dwellMin",
    value: 120,
    note: "stayed longer",
  });
  expect(ok.field).toBe("dwellMin");
  expect(ok.value).toBe(120);
  expect(() =>
    PlaceOverrideRequestSchema.parse({ field: "dwellMin", value: 120, by: "admin" }),
  ).toThrow();
  expect(() => PlaceOverrideRequestSchema.parse({ field: "status", value: "hidden" })).toThrow();
  expect(() => PlaceOverrideRequestSchema.parse({ field: "dwellMin", value: "nope" })).toThrow();
  expect(() => PlaceOverrideRequestSchema.parse({ field: "notAField", value: 1 })).toThrow();
});

test("hide body is a reason string", () => {
  expect(PlaceHideRequestSchema.parse({ reason: "closed for good" }).reason).toBe(
    "closed for good",
  );
  expect(() => PlaceHideRequestSchema.parse({ reason: "  " })).toThrow();
  expect(() => PlaceHideRequestSchema.parse({ reason: "closed", by: "uid" })).toThrow();
});

test("merge body is merge-with-keep or keep_both", () => {
  expect(ResolveMergeRequestSchema.parse({ action: "merge", keep: "a" })).toEqual({
    action: "merge",
    keep: "a",
  });
  expect(ResolveMergeRequestSchema.parse({ action: "keep_both" })).toEqual({ action: "keep_both" });
  expect(() => ResolveMergeRequestSchema.parse({ action: "merge" })).toThrow();
  expect(() => ResolveMergeRequestSchema.parse({ action: "keep_both", keep: "b" })).toThrow();
  expect(() => ResolveMergeRequestSchema.parse({ action: "delete" })).toThrow();
});

test("review session body names a destination and a run", () => {
  expect(CreateReviewRequestSchema.parse({ destSlug: "tuscany", runId: "run_1" }).runId).toBe(
    "run_1",
  );
  expect(() => CreateReviewRequestSchema.parse({ destSlug: "Tuscany", runId: "run_1" })).toThrow();
});

test("review verdict is correct, hide, or wrong with a reason", () => {
  expect(
    ReviewVerdictRequestSchema.parse({ placeId: "p1", verdict: "wrong", reason: "closed" }),
  ).toEqual({ placeId: "p1", verdict: "wrong", reason: "closed" });
  expect(ReviewVerdictRequestSchema.parse({ placeId: "p1", verdict: "correct" }).verdict).toBe(
    "correct",
  );
  expect(ReviewVerdictRequestSchema.parse({ placeId: "p1", verdict: "hide" }).verdict).toBe("hide");
  expect(() => ReviewVerdictRequestSchema.parse({ placeId: "p1", verdict: "wrong" })).toThrow();
  expect(() =>
    ReviewVerdictRequestSchema.parse({ placeId: "p1", verdict: "correct", reason: "closed" }),
  ).toThrow();
  expect(() =>
    ReviewVerdictRequestSchema.parse({ placeId: "p1", verdict: "wrong", reason: "boring" }),
  ).toThrow();
});

test("admin scout success bodies", () => {
  expect(
    CreateDestinationResponseSchema.parse({
      ok: true,
      slug: "tuscany",
      status: "queued",
      queueOrder: 0,
    }).status,
  ).toBe("queued");
  expect(
    ReorderDestinationsResponseSchema.parse({
      ok: true,
      order: [{ slug: "rome", queueOrder: 0 }],
    }).order[0]?.queueOrder,
  ).toBe(0);
  expect(DeleteDestinationResponseSchema.parse({ ok: true, slug: "rome" }).ok).toBe(true);
  expect(PlaceOverrideResponseSchema.parse({ ok: true, id: "p1", field: "dwellMin" }).field).toBe(
    "dwellMin",
  );
  expect(PlaceHideResponseSchema.parse({ ok: true, id: "p1", status: "hidden" }).status).toBe(
    "hidden",
  );
  expect(ResolveMergeResponseSchema.parse({ ok: true, id: "m1", status: "merged" }).status).toBe(
    "merged",
  );
  expect(
    CreateReviewResponseSchema.parse({ ok: true, id: "rev_1", sampleSize: 60 }).sampleSize,
  ).toBe(60);
  expect(
    ReviewVerdictResponseSchema.parse({ ok: true, id: "rev_1", accuracy: 0.5, completed: false })
      .accuracy,
  ).toBe(0.5);
  expect(() =>
    CreateReviewResponseSchema.parse({ ok: true, id: "rev_1", sampleSize: 61 }),
  ).toThrow();
});
