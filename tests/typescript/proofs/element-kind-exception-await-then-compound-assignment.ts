/*---
description: An awaited then throw preserves element-kind effects in compound assignment.
features: [ts-proof-element-kind, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-numbers, ts-expressions]
flags: [async]
---*/
// Fact: the allocation initially contains only small integers (docs/foundations/objects.md, Arrays).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function checkOne(n: number): Promise<void> {
  const xs = [4, 8, 12];
  assert.sameValue(xs[0], 4);
  let caught = false;
  let completed = 5;
  try {
    completed += await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        xs[0] = delta + 0.5;
        throw new Error("callback write");
      }
      return 2;
    });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "callback write");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  assert.sameValue(completed, n > 0 ? 5 : 7);
  assert.sameValue(xs[0], n > 0 ? n + 0.5 : 4);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
