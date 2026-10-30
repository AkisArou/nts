/*---
description: An awaited then throw preserves whole-number effects in destructuring default.
features: [ts-proof-whole-number, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-numbers, ts-destructuring]
flags: [async]
---*/
// Fact: the initial number is whole and has no NaN (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function checkOne(n: number): Promise<void> {
  let value = 2147483647;
  assert.sameValue(value, 2147483647);
  let caught = false;
  let completed = -1;
  try {
    const [ticket = await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        value += delta;
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
  assert.sameValue(value, n > 0 ? 2147483647 + n : 2147483647);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
