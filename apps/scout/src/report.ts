export interface RunReportSummary {
  places: number;
  trendingVerified: number;
  rejected: number;
  pendingMerges: number;
  budget: { llmCalls: number; searches: number };
}

/** Markdown run report. Every count is printed as given. */
export function renderReport(summary: RunReportSummary): string {
  const { budget } = summary;
  return [
    "# Scout run",
    "",
    `Places: ${summary.places}`,
    `Trending verified: ${summary.trendingVerified}`,
    `Rejected: ${summary.rejected}`,
    `Pending merges: ${summary.pendingMerges}`,
    `Budget: llm ${budget.llmCalls} searches ${budget.searches}`,
    "",
  ].join("\n");
}
