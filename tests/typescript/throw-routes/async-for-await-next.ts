/*---
description: For-await reaches an interface async iterator whose next rejects after retaining its effects.
features: [ts-throw-route-async, ts-async, ts-errors, ts-unknown, ts-interfaces, ts-iteration, ts-symbols, ts-arrays]
flags: [async]
---*/
// Route: interface async iterator next through for-await; node preserves the original fault identity in the awaiting caller catch and follows the logged cleanup order.
interface Cursor { next(): Promise<IteratorResult<number, undefined>>; return(): Promise<IteratorResult<number, undefined>>; }
interface Stream { [Symbol.asyncIterator](): Cursor; }
async function main(): Promise<void> {
  for (const failAt of [-1, 0, 1]) {
    const log: string[] = [], result: number[] = []; let state = 0, index = 0, closed = 0, completed = false, caught = false;
    const fault = new RangeError("next fault");
    async function nextBody(argc: number): Promise<IteratorResult<number, undefined>> {
      const step = index++; state++; log.push(`next:${step}:${argc}:${state}`);
      try {
        await Promise.resolve();
        if (step === failAt) { log.push(`throw:${state}`); throw fault; }
        if (step === 2) { log.push(`done:${state}`); return { done: true, value: undefined }; }
        const value = step === 0 ? 4 : 7; log.push(`yield:${value}:${state}`); return { done: false, value };
      } finally { state += 10; log.push(`next-finally:${state}`); }
    }
    const cursor: Cursor = {
      next() { assert.sameValue(this, cursor); return nextBody(arguments.length); },
      async return() { closed++; state += 100000; log.push(`return:${state}`); return { done: true, value: undefined }; }
    };
    const source: Stream = { [Symbol.asyncIterator]() { assert.sameValue(this, source); state += 100; log.push(`iterator:${arguments.length}:${state}`); return cursor; } };
    try {
      try { log.push("route:0"); for await (const value of source) { result.push(value); log.push(`body:${value}:${state}`); } completed = true; log.push(`after:${state}`); }
      finally { state += 1000; log.push(`caller-finally:${state}`); }
    } catch (error: unknown) {
      assert.sameValue(error, fault); assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, "next fault"); }
      caught = true; log.push(`catch:${state}`);
    } finally { state += 10000; log.push(`outer-finally:${state}`); }
    assert.compareArray(result, failAt === 0 ? [] : failAt === 1 ? [4] : [4, 7]);
    assert.sameValue(completed, failAt < 0); assert.sameValue(caught, failAt >= 0); assert.sameValue(closed, 0);
    const pulls = failAt < 0 ? 3 : failAt + 1, stopped = 100 + pulls * 11;
    assert.sameValue(index, pulls); assert.sameValue(state, stopped + 11000);
    const expected = ["route:0", "iterator:0:100"];
    for (let step = 0; step < pulls; step++) {
      const before = 101 + step * 11, value = step === 0 ? 4 : 7;
      expected.push(`next:${step}:0:${before}`, step === failAt ? `throw:${before}` : step === 2 ? `done:${before}` : `yield:${value}:${before}`, `next-finally:${before + 10}`);
      if (step !== failAt && step < 2) expected.push(`body:${value}:${before + 10}`);
    }
    if (failAt < 0) expected.push(`after:${stopped}`);
    expected.push(`caller-finally:${stopped + 1000}`); if (failAt >= 0) expected.push(`catch:${stopped + 1000}`);
    expected.push(`outer-finally:${stopped + 11000}`); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
