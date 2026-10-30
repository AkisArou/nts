/*---
description: An awaited then throw preserves negative-zero effects in async generator yield.
features: [ts-proof-negative-zero, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-numbers, ts-generators, ts-async-generators]
flags: [async]
---*/
// Fact: the initial value has no negative-zero sign (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function* observe(n: number): AsyncGenerator<number> {
  let value = 0;
  yield value;
  let caught = false;
  try {
    yield await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        value = 0 / -delta;
        throw new Error("callback write");
      }
      return 7;
    });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "callback write");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  yield value;
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const actual: number[] = [];
    for await (const value of observe(n)) actual.push(value);
    const final = n > 0 ? -0 : 0;
    const expected = n > 0 ? [0, final] : [0, 7, final];
    assert.sameValue(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.sameValue(actual[i], expected[i]);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
