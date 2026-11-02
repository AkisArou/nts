/*---
description: A tuple-held generator runs inner and outer finally blocks once on early return, including zero-yield natural completion.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-tuples, ts-class, ts-interfaces]
---*/
// Explicit state-number control; A tuple element carries generator methods; node unwinds inner then outer finally and keeps completed calls effect-free.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function model(count: number, value: Value, log: unknown[]): Cursor {
  let state = 0, index = 0;
  function close(): void { if (state === 1) log.push("inner:finally", "outer:finally"); state = 2; }
  return { [Symbol.iterator](): Cursor { return this; },
    next(): Step { if (state === 2) return { value: undefined, done: true }; if (state === 0) { state = 1; log.push("outer:enter", "inner:enter"); } if (index++ < count) { log.push("yield", value); return { value, done: false }; } close(); return { value: "natural", done: true }; },
    return(value?: Value): Step { close(); return { value, done: true }; }, throw(error?: unknown): Step { close(); throw error; } };
}
class Source { open(count: number, value: Value, log: unknown[]): Cursor { return model(count, value, log); } }
const literal = { open(count: number, value: Value, log: unknown[]): Cursor { return model(count, value, log); } };
interface Factory { open(count: number, value: Value, log: unknown[]): Cursor; }
const makers: Factory[] = [new Source(), literal];
const identity = { id: 29 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], pair: [Cursor, string] = [make.open(count, value, log), "chosen"];
  check(pair[0].next("ignored"), count === 0 ? "natural" : value, count === 0, seen);
  check(pair[0].return(value), value, true, seen); check(pair[0].next(), undefined, true, seen); check(pair[0].return(identity), identity, true, seen);
  const expected: unknown[] = ["outer:enter", "inner:enter"]; if (count > 0) expected.push("yield", value); expected.push("inner:finally", "outer:finally");
  assert.compareArray(log, expected); assert.sameValue(pair[1], "chosen");
}
