/*---
description: An awaited then throw preserves call-target effects in compound assignment.
features: [ts-proof-call-target, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-expressions]
flags: [async]
---*/
// Fact: the initial function value has a known target (docs/foundations/objects.md, Calls).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function checkOne(n: number): Promise<void> {
  let target = (x: number): number => x + 1;
  assert.sameValue(target(4), 5);
  let caught = false;
  let completed = 5;
  try {
    completed += await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        target = (x: number): number => 3 * x + delta;
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
  assert.sameValue(target(4), n > 0 ? 12 + n : 5);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
