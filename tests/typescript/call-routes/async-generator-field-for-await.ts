/*---
description: For await consumes an async generator obtained by calling a typed field, including a later rejection.
features: [ts-call-route-suspension, ts-async, ts-async-generators, ts-generators, ts-function-types, ts-objects, ts-iteration, ts-errors, ts-unknown]
flags: [async]
---*/
// Route: for await consumes a generator obtained through a function-typed field; node preserves its partial yield and cleanup on rejection.
const log: string[] = [];
let state = 0;
async function* produce(n: number): AsyncGenerator<number, void, void> {
  log.push(`enter:${n}:${state}`);
  try {
    state = n;
    yield n;
    await Promise.resolve();
    state += 1; log.push(`resume:${state}`);
    if (n < 0) throw new RangeError(`route:${n}`);
    yield state;
  } finally { state += 10; log.push(`callee-finally:${state}`); }
}
const holder: { run: (n: number) => AsyncGenerator<number, void, void> } = { run: produce };
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    state = 0; log.length = 0;
    const values: number[] = [];
    try {
      for await (const value of holder.run(n)) {
        values.push(value); log.push(`yield:${value}:${state}`);
      }
      log.push(`done:${state}`);
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      assert.sameValue(error.message, `route:${n}`);
      log.push(`catch:${error.message}:${state}`);
    } finally { state += 100; log.push(`caller-finally:${state}`); }
    assert.compareArray(values, n < 0 ? [n] : [n, n + 1]);
    assert.sameValue(state, n + 111);
    const expected = [`enter:${n}:0`, `yield:${n}:${n}`, `resume:${n + 1}`];
    if (n >= 0) expected.push(`yield:${n + 1}:${n + 1}`);
    expected.push(`callee-finally:${n + 11}`, n < 0 ? `catch:route:${n}:${n + 11}` : `done:${n + 11}`);
    expected.push(`caller-finally:${n + 111}`);
    assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
