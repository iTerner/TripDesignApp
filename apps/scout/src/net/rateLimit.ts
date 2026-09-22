export function createLimiter(
  minIntervalMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = delay,
): { wait: () => Promise<void> } {
  let last = Number.NEGATIVE_INFINITY;
  let tail: Promise<void> = Promise.resolve();

  return {
    wait(): Promise<void> {
      const run = tail.then(async () => {
        const elapsed = now() - last;
        if (Number.isFinite(last) && elapsed < minIntervalMs) {
          await sleep(minIntervalMs - elapsed);
        }
        last = now();
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
