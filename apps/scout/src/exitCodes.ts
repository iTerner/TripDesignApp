export const EXIT = {
  done: 0,
  error: 1,
  refused: 2,
  awaitingPackets: 3,
  pausedBudget: 4,
  pausedRejections: 5,
} as const;
