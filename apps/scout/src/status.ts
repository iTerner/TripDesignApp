export interface StatusBoard {
  slug: string;
  stage: string;
  packets: { pending: number; answered: number; rejected: number };
  places: number;
  budget: { llmCalls: number; searches: number };
  elapsedSec: number;
}

export function formatStatus(board: StatusBoard): string {
  const { packets, budget } = board;
  return [
    `slug: ${board.slug}`,
    `stage: ${board.stage}`,
    `packets: pending ${packets.pending} answered ${packets.answered} rejected ${packets.rejected}`,
    `places: ${board.places}`,
    `budget: llm ${budget.llmCalls} searches ${budget.searches}`,
    `elapsed: ${board.elapsedSec}s`,
  ].join("\n");
}
