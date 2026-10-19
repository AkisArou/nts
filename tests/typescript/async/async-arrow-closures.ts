/*---
description: Async arrows created in a loop capture each iteration's binding and resolve to it.
features: [ts-async, ts-arrow-functions, ts-closures]
flags: [async]
---*/
async function main(): Promise<void> {
  const jobs: (() => Promise<number>)[] = [];
  for (let i = 1; i <= 3; i++) {
    jobs.push(async () => {
      await null;
      return i * 10;
    });
  }
  const results = await Promise.all(jobs.map((job) => job()));
  assert.compareArray(results, [10, 20, 30]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
