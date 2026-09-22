import { createLimiter } from "./rateLimit";

test("second wait does not resolve until the remaining interval elapses", async () => {
  let clock = 10_000;
  const slept: number[] = [];
  let releaseSleep: (() => void) | undefined;
  const limiter = createLimiter(
    1_000,
    () => clock,
    (ms) => {
      slept.push(ms);
      return new Promise((resolve) => {
        releaseSleep = () => {
          clock += ms;
          resolve();
        };
      });
    },
  );

  await limiter.wait();
  expect(slept).toEqual([]);

  clock += 250;
  let resolved = false;
  const second = limiter.wait().then(() => {
    resolved = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(slept).toEqual([750]);
  expect(resolved).toBe(false);

  const finish = releaseSleep;
  expect(finish).toBeTypeOf("function");
  finish?.();
  await second;
  expect(resolved).toBe(true);
});
