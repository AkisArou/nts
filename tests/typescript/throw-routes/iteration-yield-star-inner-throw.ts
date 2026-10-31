/*---
description: yield* through an interface-held generator carries an inner throw; node unwinds inner then outer finally before the caller catches the same error.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-generators]
---*/
// Route: interface generator field -> yield* -> caller catch; node keeps the inner error and runs inner then outer finally.
interface ThrowIterationFrame { seed: number; state: number; closed: number; original: RangeError; log: string[]; }
interface ThrowIterationHolder { current: Generator<number, number, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationInnerAction(f: ThrowIterationFrame): number {
  iterationNote(f, "inner.body", 4); if (f.seed < 0) { iterationNote(f, `throw:${f.original.message}`, 0); throw f.original; } return f.seed + 1;
}
function iterationOuterAction(f: ThrowIterationFrame, delegated: number): number {
  iterationNote(f, "outer.body", 8); return delegated + 10;
}
function* iterationInner(f: ThrowIterationFrame): Generator<number, number, undefined> {
  iterationNote(f, "inner.enter", 2);
  try { yield f.seed; return iterationInnerAction(f); } finally { f.closed++; iterationNote(f, "inner.finally", 20); }
}
function* iterationOuter(f: ThrowIterationFrame, source: ThrowIterationHolder): Generator<number, number, undefined> {
  iterationNote(f, "outer.enter", 1);
  try { const delegated = yield* source.current; return iterationOuterAction(f, delegated); }
  finally { f.closed++; iterationNote(f, "outer.finally", 10); }
}
for (const seed of [-2, 0, 3]) {
  const original = new RangeError(`inner:${seed}`);
  const f: ThrowIterationFrame = { seed, state: 0, closed: 0, original, log: [] };
  const holder: ThrowIterationHolder = { current: iterationOuter(f, { current: iterationInner(f) }) };
  let yielded: number | undefined, firstDone: boolean | undefined, result: number | undefined, lastDone: boolean | undefined, caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    const first = holder.current.next(); yielded = first.value; firstDone = first.done; iterationNote(f, "resume.next", 0);
    const last = holder.current.next(); result = last.value; lastDone = last.done;
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 100); }
  finally { iterationNote(f, "caller.finally", 1000); }
  assert.sameValue(caught, seed < 0 ? original : undefined);
  if (seed < 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `inner:${seed}`); }
  assert.sameValue(yielded, seed); assert.sameValue(firstDone, false);
  assert.sameValue(result, seed < 0 ? undefined : seed + 11); assert.sameValue(lastDone, seed < 0 ? undefined : true);
  assert.sameValue(f.closed, 2); assert.sameValue(f.state, seed < 0 ? 1137 : 1045);
  assert.compareArray(f.log, seed < 0
    ? ["caller:0", "outer.enter:1", "inner.enter:3", "resume.next:3", "inner.body:7", `throw:inner:${seed}:7`, "inner.finally:27", "outer.finally:37", "catch:137", "caller.finally:1137"]
    : ["caller:0", "outer.enter:1", "inner.enter:3", "resume.next:3", "inner.body:7", "inner.finally:27", "outer.body:35", "outer.finally:45", "complete:45", "caller.finally:1045"]);
}
