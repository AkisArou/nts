/*---
description: A microtask append contributes a fraction to the array read after await.
features: [ts-proof-element-kind, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-async, ts-closures]
flags: [async]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a microtask pushes 0.25 across await; the separate reader retains it.
function readLast(xs: number[]): number { return xs[xs.length - 1]; }
async function observe(n: number): Promise<number> {
  const xs = [1, 2];
  const pending = Promise.resolve().then(() => {
    if (n > 0) xs.push(0.25);
  });
  await pending;
  return readLast(xs);
}
async function check(): Promise<void> {
  for (const n of [0, 1, 3, 4, 7]) {
    assert.sameValue(await observe(n), n > 0 ? 0.25 : 2);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
