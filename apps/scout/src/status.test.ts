import { formatStatus } from "./status";

test("status board names stage, packets and budget", () => {
  const text = formatStatus({
    slug: "tuscany",
    stage: "03-trends",
    packets: { pending: 2, answered: 4, rejected: 1 },
    places: 80,
    budget: { llmCalls: 6, searches: 4 },
    elapsedSec: 12,
  });
  expect(text).toContain("tuscany");
  expect(text).toContain("03-trends");
  expect(text).toContain("pending 2");
  expect(text).toContain("llm 6");
});
