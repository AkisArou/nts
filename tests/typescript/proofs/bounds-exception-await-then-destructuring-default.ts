/*---
description: An awaited then throw preserves bounds effects in destructuring default.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-destructuring]
flags: [async]
---*/
// Fact: the allocated array proves the selected index is initially in range (docs/foundations/objects.md, Arrays).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function checkOne(n: number): Promise<void> {
  const xs = [10, 20, 30];
  const index = 2;
  assert.sameValue(xs[index], 30);
  let caught = false;
  let completed = -1;
  try {
    const [ticket = await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        xs.length = 2;
        throw new Error("callback write");
      }
      return 2;
    })] = n < 0 ? [9] : [];
    completed = ticket;
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "callback write");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  assert.sameValue(completed, n > 0 ? -1 : n < 0 ? 9 : 2);
  assert.sameValue(xs.length, n > 0 ? 2 : 3);
  xs[index] = 40 + n;
  assert.sameValue(xs.length, 3);
  assert.sameValue(xs[index], 40 + n);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
