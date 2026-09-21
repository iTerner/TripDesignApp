import { nextResetIso, providerDayKey } from "./reset";

test("google day key uses Pacific time; openrouter uses UTC", () => {
  // 2026-09-20T05:30Z is 2026-09-19 22:30 in Los Angeles (PDT, UTC-7)
  expect(providerDayKey("google", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-19");
  expect(providerDayKey("openrouter", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-20");
});

test("next reset is the following midnight in the provider zone", () => {
  expect(nextResetIso("openrouter", new Date("2026-09-20T05:30:00Z"))).toBe(
    "2026-09-21T00:00:00.000Z",
  );
  expect(nextResetIso("google", new Date("2026-09-20T05:30:00Z"))).toBe("2026-09-20T07:00:00.000Z"); // 00:00 PDT
  expect(nextResetIso("google", new Date("2026-09-20T12:00:00Z"))).toBe("2026-09-21T07:00:00.000Z");
});
