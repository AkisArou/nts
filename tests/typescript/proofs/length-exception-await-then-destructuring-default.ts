/*---
description: An awaited then throw preserves length effects in destructuring default.
features: [ts-proof-length, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-destructuring]
flags: [async]
---*/
// Fact: the allocation proves an initial array length (docs/foundations/objects.md, Arrays).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function checkOne(n: number): Promise<void> {
  const xs = [1, 2, 3, 4];
  assert.sameValue(xs.length, 4);
  let caught = false;
  let completed = -1;
  try {
    const [ticket = await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        xs.splice(1, 2);
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
  assert.sameValue(xs.length, n > 0 ? 2 : 4);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
