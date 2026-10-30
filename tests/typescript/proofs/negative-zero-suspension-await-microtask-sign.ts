/*---
description: An awaited microtask can invalidate a captured positive-zero fact.
features: [ts-proof-negative-zero, ts-route-suspension, ts-functions, ts-iteration, ts-numbers, ts-async, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the microtask writes -0 during suspension; node retains it after resumption.
async function afterAwait(n: number): Promise<number> {
  let value = 0;
  const write = Promise.resolve().then(() => {
    if (n > 0) value = -0;
  });
  await write;
  return value;
}

async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    assert.sameValue(await afterAwait(n), n > 0 ? -0 : 0);
  }
}
check().then(() => $DONE(), $DONE);
