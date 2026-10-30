/*---
description: An awaited microtask can replace a proved integer with a fraction.
features: [ts-proof-whole-number, ts-route-suspension, ts-functions, ts-iteration, ts-numbers, ts-async, ts-closures, ts-arrow-functions]
flags: [async]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the microtask writes during suspension; node reads 0.5 after resumption.
async function afterAwait(n: number): Promise<number> {
  let value = 1;
  const write = Promise.resolve().then(() => {
    if (n > 0) value = 0.5;
  });
  await write;
  return value;
}

async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    assert.sameValue(await afterAwait(n), n > 0 ? 0.5 : 1);
  }
}
check().then(() => $DONE(), $DONE);
