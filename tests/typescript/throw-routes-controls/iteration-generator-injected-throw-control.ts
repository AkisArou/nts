/*---
description: Control for iteration-generator-injected-throw; the throwing action is called directly inside the caller try.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-generators]
---*/
// Control: ../throw-routes/iteration-generator-injected-throw.ts; The named injection action throws directly inside the caller try, surrounded by the same explicit cleanup.
interface ThrowIterationFrame { seed: number; state: number; closed: number; original: RangeError; log: string[]; }
interface ThrowIterationHolder { current: Generator<number, number, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationInjected(f: ThrowIterationFrame, error: unknown): never {
  assert.sameValue(error, f.original); assert.sameValue(error instanceof RangeError, true);
  iterationNote(f, "generator.catch", 2); iterationNote(f, `throw:${f.original.message}`, 0); throw error;
}
function iterationFinish(f: ThrowIterationFrame): number { iterationNote(f, "finish", 2); return f.seed + 1; }
function* iterationGenerator(f: ThrowIterationFrame): Generator<number, number, undefined> {
  iterationNote(f, "generator.enter", 1);
  try { try { yield f.seed; } catch (error: unknown) { iterationInjected(f, error); } return iterationFinish(f); }
  finally { f.closed++; iterationNote(f, "generator.finally", 10); }
}
for (const seed of [-2, 0, 3]) {
  const original = new RangeError(`injected:${seed}`);
  const f: ThrowIterationFrame = { seed, state: 0, closed: 0, original, log: [] };
  const holder: ThrowIterationHolder = { current: iterationGenerator(f) };
  let yielded: number | undefined, firstDone: boolean | undefined, result: number | undefined, lastDone: boolean | undefined, caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    iterationNote(f, "generator.enter", 1); yielded = seed; firstDone = false;
    iterationNote(f, seed < 0 ? "resume.throw" : "resume.next", 0);
    try { result = seed < 0 ? iterationInjected(f, original) : iterationFinish(f); lastDone = true; }
    finally { f.closed++; iterationNote(f, "generator.finally", 10); }
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 100); }
  finally { iterationNote(f, "caller.finally", 1000); }
  assert.sameValue(caught, seed < 0 ? original : undefined);
  if (seed < 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `injected:${seed}`); }
  assert.sameValue(yielded, seed); assert.sameValue(firstDone, false);
  assert.sameValue(result, seed < 0 ? undefined : seed + 1); assert.sameValue(lastDone, seed < 0 ? undefined : true);
  assert.sameValue(f.closed, 1); assert.sameValue(f.state, seed < 0 ? 1113 : 1013);
  assert.compareArray(f.log, seed < 0
    ? ["caller:0", "generator.enter:1", "resume.throw:1", "generator.catch:3", `throw:injected:${seed}:3`, "generator.finally:13", "catch:113", "caller.finally:1113"]
    : ["caller:0", "generator.enter:1", "resume.next:1", "finish:3", "generator.finally:13", "complete:13", "caller.finally:1013"]);
}
