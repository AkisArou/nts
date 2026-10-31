/*---
description: A generator resumed through an interface field throws from its body; node preserves the yielded value, original error and generator-before-caller finally order.
features: [ts-throw-route-iteration, ts-iteration, ts-errors, ts-unknown, ts-interfaces, ts-functions, ts-objects, ts-arrays, ts-generators]
---*/
// Route: interface generator field -> next -> caller catch; node carries the same body error after generator finally.
interface ThrowIterationFrame { seed: number; state: number; closed: number; original: RangeError; log: string[]; }
interface ThrowIterationHolder { current: Generator<number, number, undefined>; }
function iterationNote(f: ThrowIterationFrame, text: string, amount: number): void { f.state += amount; f.log.push(`${text}:${f.state}`); }
function iterationGeneratorBody(f: ThrowIterationFrame): number {
  iterationNote(f, "body", 2);
  if (f.seed < 0) { iterationNote(f, `throw:${f.original.message}`, 0); throw f.original; }
  return f.seed + 1;
}
function* iterationGenerator(f: ThrowIterationFrame): Generator<number, number, undefined> {
  iterationNote(f, "generator.enter", 1);
  try { yield f.seed; return iterationGeneratorBody(f); }
  finally { f.closed++; iterationNote(f, "generator.finally", 10); }
}
for (const seed of [-2, 0, 3]) {
  const original = new RangeError(`generator:${seed}`);
  const f: ThrowIterationFrame = { seed, state: 0, closed: 0, original, log: [] };
  const holder: ThrowIterationHolder = { current: iterationGenerator(f) };
  let yielded: number | undefined, firstDone: boolean | undefined, result: number | undefined, lastDone: boolean | undefined, caught: unknown;
  try {
    iterationNote(f, "caller", 0);
    const first = holder.current.next(); yielded = first.value; firstDone = first.done; iterationNote(f, "resume.next", 0);
    const last = holder.current.next(); result = last.value; lastDone = last.done;
    iterationNote(f, "complete", 0);
  } catch (error: unknown) { caught = error; iterationNote(f, "catch", 100); }
  finally { iterationNote(f, "caller.finally", 1000); }
  assert.sameValue(caught, seed < 0 ? original : undefined);
  if (seed < 0) { assert.sameValue(caught instanceof RangeError, true); if (caught instanceof RangeError) assert.sameValue(caught.message, `generator:${seed}`); }
  assert.sameValue(yielded, seed); assert.sameValue(firstDone, false);
  assert.sameValue(result, seed < 0 ? undefined : seed + 1); assert.sameValue(lastDone, seed < 0 ? undefined : true);
  assert.sameValue(f.closed, 1); assert.sameValue(f.state, seed < 0 ? 1113 : 1013);
  assert.compareArray(f.log, seed < 0
    ? ["caller:0", "generator.enter:1", "resume.next:1", "body:3", `throw:generator:${seed}:3`, "generator.finally:13", "catch:113", "caller.finally:1113"]
    : ["caller:0", "generator.enter:1", "resume.next:1", "body:3", "generator.finally:13", "complete:13", "caller.finally:1013"]);
}
