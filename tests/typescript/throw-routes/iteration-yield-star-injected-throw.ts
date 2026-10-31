/*---
description: An outer generator throw through an interface field reaches the suspended yield* delegate; node rethrows the same error from the inner catch and closes inner before outer.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-generators]
---*/
// Route: interface generator field -> throw during yield* -> caller catch; node forwards the same error inward, then runs inner and outer finally.
interface ThrowIterationFrame { seed: number; state: number; closed: number; original: RangeError; log: string[]; }
interface ThrowIterationHolder { current: Generator<number, number, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationInjected(f: ThrowIterationFrame, error: unknown): never {
  assert.sameValue(error, f.original); assert.sameValue(error instanceof RangeError, true);
  if (error instanceof RangeError) assert.sameValue(error.message, `delegated:${f.seed}`);
  iterationNote(f, "inner.catch", 4); iterationNote(f, `throw:${f.original.message}`, 0); throw error;
}
function iterationInnerFinish(f: ThrowIterationFrame): number { iterationNote(f, "inner.return", 4); return f.seed + 1; }
function iterationOuterFinish(f: ThrowIterationFrame, value: number): number { iterationNote(f, "outer.return", 8); return value + 10; }
function* iterationInner(f: ThrowIterationFrame): Generator<number, number, undefined> {
  iterationNote(f, "inner.enter", 2);
  try { try { yield f.seed; } catch (error: unknown) { iterationInjected(f, error); } return iterationInnerFinish(f); }
  finally { f.closed++; iterationNote(f, "inner.finally", 20); }
}
function* iterationOuter(f: ThrowIterationFrame, source: ThrowIterationHolder): Generator<number, number, undefined> {
  iterationNote(f, "outer.enter", 1);
  try { const delegated = yield* source.current; return iterationOuterFinish(f, delegated); }
  finally { f.closed++; iterationNote(f, "outer.finally", 10); }
}
for (const seed of [-2, 0, 3]) {
  const original = new RangeError(`delegated:${seed}`);
  const f: ThrowIterationFrame = { seed, state: 0, closed: 0, original, log: [] };
  const holder: ThrowIterationHolder = { current: iterationOuter(f, { current: iterationInner(f) }) };
  let yielded: number | undefined, firstDone: boolean | undefined, result: number | undefined, lastDone: boolean | undefined, caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    const first = holder.current.next(); yielded = first.value; firstDone = first.done;
    iterationNote(f, seed < 0 ? "resume.throw" : "resume.next", 0);
    const last = seed < 0 ? holder.current.throw(original) : holder.current.next(); result = last.value; lastDone = last.done;
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 100); }
  finally { iterationNote(f, "caller.finally", 1000); }
  assert.sameValue(caught, seed < 0 ? original : undefined);
  if (seed < 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `delegated:${seed}`); }
  assert.sameValue(yielded, seed); assert.sameValue(firstDone, false);
  assert.sameValue(result, seed < 0 ? undefined : seed + 11); assert.sameValue(lastDone, seed < 0 ? undefined : true);
  assert.sameValue(f.closed, 2); assert.sameValue(f.state, seed < 0 ? 1137 : 1045);
  assert.compareArray(f.log, seed < 0
    ? ["caller:0", "outer.enter:1", "inner.enter:3", "resume.throw:3", "inner.catch:7", `throw:delegated:${seed}:7`, "inner.finally:27", "outer.finally:37", "catch:137", "caller.finally:1137"]
    : ["caller:0", "outer.enter:1", "inner.enter:3", "resume.next:3", "inner.return:7", "inner.finally:27", "outer.return:35", "outer.finally:45", "complete:45", "caller.finally:1045"]);
}
