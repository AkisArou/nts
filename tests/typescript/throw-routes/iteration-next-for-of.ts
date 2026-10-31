/*---
description: An interface iterator next throws through for-of; node preserves the error and partial output without calling return.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-symbols]
---*/
// Route: interface iterable -> for-of -> caller catch; node keeps the original error, runs next finally, and does not close.
interface ThrowIterationFrame { failAt: number; index: number; state: number; closed: number; original: RangeError; log: string[]; }
interface ThrowIterationSequence { [Symbol.iterator](): Iterator<number, undefined, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationAcquire(f: ThrowIterationFrame): void { iterationNote(f, "iterator", 100); }
function iterationNext(f: ThrowIterationFrame): IteratorResult<number, undefined> {
  const index = f.index++; iterationNote(f, `next:${index}`, 1);
  try {
    if (index === f.failAt) { iterationNote(f, `throw:${f.original.message}`, 0); throw f.original; }
    return index < 2 ? { done: false, value: 10 + index } : { done: true, value: undefined };
  } finally { iterationNote(f, `next.finally:${index}`, 10); }
}
function iterationClose(f: ThrowIterationFrame): IteratorResult<number, undefined> {
  f.closed++; iterationNote(f, "return", 100000); return { done: true, value: undefined };
}
function iterationSequence(f: ThrowIterationFrame): ThrowIterationSequence {
  return { [Symbol.iterator]() { iterationAcquire(f); return { next() { return iterationNext(f); }, return() { return iterationClose(f); } }; } };
}
for (const failAt of [-1, 0, 1]) {
  const original = new RangeError(`next:${failAt}`);
  const f: ThrowIterationFrame = { failAt, index: 0, state: 0, closed: 0, original, log: [] };
  const route: ThrowIterationSequence = iterationSequence(f); let result: number[] = [], caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    for (const value of route) result.push(value);
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 1000); }
  finally { iterationNote(f, "caller.finally", 10000); }
  assert.sameValue(caught, failAt < 0 ? undefined : original);
  if (failAt >= 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `next:${failAt}`); }
  assert.compareArray(result, failAt < 0 ? [10, 11] : failAt === 1 ? [10] : []);
  const pulls = failAt < 0 ? 3 : failAt + 1, before = 100 + 11 * pulls;
  assert.sameValue(f.index, pulls); assert.sameValue(f.closed, 0);
  assert.sameValue(f.state, before + (failAt < 0 ? 0 : 1000) + 10000);
  const expected = ["caller:0", "iterator:100"];
  for (let i = 0; i < pulls; i++) {
    expected.push(`next:${i}:${101 + 11 * i}`);
    if (i === failAt) expected.push(`throw:next:${failAt}:${101 + 11 * i}`);
    expected.push(`next.finally:${i}:${111 + 11 * i}`);
  }
  expected.push(failAt < 0 ? `complete:${before}` : `catch:${before + 1000}`, `caller.finally:${before + (failAt < 0 ? 0 : 1000) + 10000}`);
  assert.compareArray(f.log, expected);
}
