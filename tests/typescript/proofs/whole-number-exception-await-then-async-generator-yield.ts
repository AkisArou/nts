/*---
description: An awaited then throw preserves whole-number effects in async generator yield.
features: [ts-proof-whole-number, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-arrays, ts-async, ts-errors, ts-iteration, ts-numbers, ts-generators, ts-async-generators]
flags: [async]
---*/
// Fact: the initial number is whole and has no NaN (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the callback writes then throws; node catches at await and keeps the changed fact.
async function* observe(n: number): AsyncGenerator<number> {
  let value = 7;
  yield value;
  let caught = false;
  try {
    yield await Promise.resolve(n).then(delta => {
      if (delta > 0) {
        value = NaN;
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
    const final = n > 0 ? NaN : 7;
    const expected = n > 0 ? [7, final] : [7, 7, final];
    assert.sameValue(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.sameValue(actual[i], expected[i]);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
