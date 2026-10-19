/*---
description: Awaits inside a for-of loop run one after another, in order.
features: [ts-async]
flags: [async]
---*/
const started: number[] = [];
async function step(n: number): Promise<number> {
  started.push(n);
  await null;
  return n * n;
}
async function main(): Promise<void> {
  const results: number[] = [];
  for (const n of [3, 1, 2]) results.push(await step(n));
  assert.compareArray(results, [9, 1, 4]);
  assert.compareArray(started, [3, 1, 2]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
