/*---
description: Control for iteration-return-early-close; the throwing action is called directly inside the caller try.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-symbols]
---*/
// Control: ../throw-routes/iteration-return-early-close.ts; The named return action is invoked directly inside the caller try after an explicit first step.
interface ThrowIterationFrame { seed: number; index: number; state: number; closed: number; original: RangeError; log: string[]; }
interface ThrowIterationSequence { [Symbol.iterator](): Iterator<number, undefined, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationAcquire(f: ThrowIterationFrame): void { iterationNote(f, "iterator", 1); }
function iterationNext(f: ThrowIterationFrame): IteratorResult<number, undefined> {
  const index = f.index++; iterationNote(f, `next:${index}`, 2);
  return index < 2 ? { done: false, value: f.seed + index } : { done: true, value: undefined };
}
function iterationClose(f: ThrowIterationFrame): IteratorResult<number, undefined> {
  f.closed++; iterationNote(f, "return", 4);
  try {
    if (f.seed < 0) { iterationNote(f, `throw:${f.original.message}`, 0); throw f.original; }
    iterationNote(f, "return.ok", 0); return { done: true, value: undefined };
  } finally { iterationNote(f, "return.finally", 40); }
}
function iterationSequence(f: ThrowIterationFrame): ThrowIterationSequence {
  return { [Symbol.iterator]() { iterationAcquire(f); return { next() { return iterationNext(f); }, return() { return iterationClose(f); } }; } };
}
for (const seed of [-2, 0, 3]) {
  const original = new RangeError(`return:${seed}`);
  const f: ThrowIterationFrame = { seed, index: 0, state: 0, closed: 0, original, log: [] };
  const route: ThrowIterationSequence = iterationSequence(f), result: number[] = []; let caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    iterationAcquire(f); const step = iterationNext(f);
    if (!step.done) { result.push(step.value); iterationNote(f, `body:${step.value}`, 3); iterationClose(f); }
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 10); }
  finally { iterationNote(f, "caller.finally", 100); }
  assert.sameValue(caught, seed < 0 ? original : undefined);
  if (seed < 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `return:${seed}`); }
  assert.compareArray(result, [seed]); assert.sameValue(f.index, 1); assert.sameValue(f.closed, 1);
  assert.sameValue(f.state, seed < 0 ? 160 : 150);
  assert.compareArray(f.log, ["caller:0", "iterator:1", "next:0:3", `body:${seed}:6`, "return:10",
    seed < 0 ? `throw:return:${seed}:10` : "return.ok:10", "return.finally:50",
    seed < 0 ? "catch:60" : "complete:50", seed < 0 ? "caller.finally:160" : "caller.finally:150"]);
}
