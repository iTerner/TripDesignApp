import { renderReport } from "./report";

test("renderReport includes the five numbers it was given", () => {
  const text = renderReport({
    places: 17,
    trendingVerified: 23,
    rejected: 31,
    pendingMerges: 41,
    budget: { llmCalls: 53, searches: 59 },
  });
  expect(text).toContain("17");
  expect(text).toContain("23");
  expect(text).toContain("31");
  expect(text).toContain("41");
  expect(text).toContain("53");
  expect(text).toContain("59");
});
