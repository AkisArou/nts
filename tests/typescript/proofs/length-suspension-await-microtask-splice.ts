/*---
description: An awaited microtask shortens an array after its length has been established.
features: [ts-proof-length, ts-route-suspension, ts-functions, ts-iteration, ts-arrays, ts-async, ts-closures]
flags: [async]
---*/
// Fact: the guard gives length 4 (docs/foundations/objects.md, Arrays).
// Route: a microtask splices during await; node resumes with length 4, 3, or 1.
async function lengthAfterAwait(n: number): Promise<number> {
  const xs = [10, 20, 30, 40];
  const pending = Promise.resolve().then(() => {
    if (n > 0) xs.splice(1, n);
  });
  if (xs.length !== 4) return -1;
  await pending;
  return xs.length;
}
async function check(): Promise<void> {
  for (const n of [0, 1, 3, 4, 7]) {
    const result = await lengthAfterAwait(n);
    assert.sameValue(result, n === 0 ? 4 : n === 1 ? 3 : 1);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
