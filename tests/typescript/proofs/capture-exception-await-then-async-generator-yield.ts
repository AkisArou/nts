/*---
description: An async generator retains each captured iteration binding after an awaited then callback writes and throws.
features: [ts-proof-capture, ts-route-exception, ts-functions, ts-arrow-functions, ts-closures, ts-function-types, ts-arrays, ts-async, ts-errors, ts-iteration, ts-generators, ts-async-generators]
flags: [async]
---*/
// Fact: the reader initially captures an unwritten binding (docs/language/functions.md, Closures).
// Route: each resumed callback writes its loop let before throwing; node catches and retains separate cells.
async function* observe(n: number): AsyncGenerator<number> {
  const readers: (() => number)[] = [];
  for (let value of [10, 20]) {
    const read = (): number => value;
    readers.push(read);
    yield read();
    let caught = false;
    try {
      yield await Promise.resolve(n).then(delta => {
        if (delta > 0) { value += delta; throw new Error("iteration write"); }
        return 7;
      });
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      assert.sameValue(error.message, "iteration write");
      caught = true;
    }
    assert.sameValue(caught, n > 0);
    yield read();
  }
  yield readers[0]();
  yield readers[1]();
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const actual: number[] = [];
    for await (const value of observe(n)) actual.push(value);
    const expected = n > 0 ? [10, 10 + n, 20, 20 + n, 10 + n, 20 + n]
                           : [10, 7, 10, 20, 7, 20, 10, 20];
    assert.sameValue(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert.sameValue(actual[i], expected[i]);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
