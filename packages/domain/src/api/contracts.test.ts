import { ApiErrorSchema, PingResponseSchema } from "./contracts";

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
  expect(() => ApiErrorSchema.parse({ error: "weird", message: "x" })).toThrow();
});
