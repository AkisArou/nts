/*---
description: A body throw through an interface iterable calls return; node keeps the original error even when return throws a distinct replacement.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-symbols]
---*/
// Route: interface iterable -> body/return throws -> caller catch; node keeps the same body error and runs both cleanup blocks.
interface ThrowIterationFrame { bad: number; index: number; state: number; closed: number; original: RangeError; replacement: TypeError; log: string[]; }
interface ThrowIterationSequence { [Symbol.iterator](): Iterator<number, undefined, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationAcquire(f: ThrowIterationFrame): void { iterationNote(f, "iterator", 1); }
function iterationNext(f: ThrowIterationFrame): IteratorResult<number, undefined> {
  const index = f.index++; iterationNote(f, `next:${index}`, 2);
  return index < 2 ? { done: false, value: 10 + index } : { done: true, value: undefined };
}
function iterationBody(f: ThrowIterationFrame, value: number): number {
  iterationNote(f, `body:${value}`, 3);
  try { if (value === f.bad) { iterationNote(f, `throw:${f.original.message}`, 0); throw f.original; } return value * 2; }
  finally { iterationNote(f, `body.finally:${value}`, 30); }
}
function iterationClose(f: ThrowIterationFrame): IteratorResult<number, undefined> {
  f.closed++; iterationNote(f, "return", 4);
  try { if (f.bad >= 0) { iterationNote(f, `throw:${f.replacement.message}`, 0); throw f.replacement; } iterationNote(f, "return.ok", 0); return { done: true, value: undefined }; }
  finally { iterationNote(f, "return.finally", 40); }
}
function iterationSequence(f: ThrowIterationFrame): ThrowIterationSequence {
  return { [Symbol.iterator]() { iterationAcquire(f); return { next() { return iterationNext(f); }, return() { return iterationClose(f); } }; } };
}
for (const bad of [-1, 10, 11]) {
  const original = new RangeError(`body:${bad}`), replacement = new TypeError(`close:${bad}`);
  const f: ThrowIterationFrame = { bad, index: 0, state: 0, closed: 0, original, replacement, log: [] };
  const route: ThrowIterationSequence = iterationSequence(f), result: number[] = []; let caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    for (const value of route) result.push(iterationBody(f, value));
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 10); }
  finally { iterationNote(f, "caller.finally", 100); }
  assert.sameValue(caught, bad < 0 ? undefined : original);
  if (bad >= 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `body:${bad}`); assert.notSameValue(caught, replacement); }
  assert.compareArray(result, bad < 0 ? [20, 22] : bad === 11 ? [20] : []);
  const visits = bad === 10 ? 1 : 2, before = 1 + 35 * visits;
  assert.sameValue(f.index, visits + (bad < 0 ? 1 : 0)); assert.sameValue(f.closed, bad < 0 ? 0 : 1);
  assert.sameValue(f.state, before + (bad < 0 ? 2 : 54) + 100);
  const expected = ["caller:0", "iterator:1"];
  for (let i = 0; i < visits; i++) {
    expected.push(`next:${i}:${3 + 35 * i}`, `body:${10 + i}:${6 + 35 * i}`);
    if (10 + i === bad) expected.push(`throw:body:${bad}:${6 + 35 * i}`);
    expected.push(`body.finally:${10 + i}:${36 + 35 * i}`);
  }
  if (bad < 0) expected.push(`next:2:${before + 2}`, `complete:${before + 2}`);
  else expected.push(`return:${before + 4}`, `throw:close:${bad}:${before + 4}`, `return.finally:${before + 44}`, `catch:${before + 54}`);
  expected.push(`caller.finally:${before + (bad < 0 ? 2 : 54) + 100}`); assert.compareArray(f.log, expected);
}
