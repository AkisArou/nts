/*---
description: A tuple-held bare-yield generator distinguishes yielded undefined from completed undefined for omitted and explicit undefined sends.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-tuples, ts-class, ts-static, ts-function-types, ts-null-undefined, ts-unions]
---*/
// Explicit state-number control; A typed tuple carries declaration and static-method generators; node uses done to distinguish each bare yield from the final undefined result.
type Value = number | string | undefined | { id: number };
type Step = IteratorResult<undefined, undefined>;
interface Cursor extends IterableIterator<undefined, undefined, Value> { return(value?: undefined): Step; throw(error?: unknown): Step; }
type Factory = (count: number, log: unknown[]) => Cursor;
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function model(count: number, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(sent?: Value): Step { if (state === 2) return { value: undefined, done: true }; if (state === 1) log.push(sent); state = 1; if (index++ < count) return { value: undefined, done: false }; state = 2; return { value: undefined, done: true }; },
    return(value?: undefined): Step { state = 2; return { value, done: true }; }, throw(error?: unknown): Step { state = 2; throw error; } };
}
function declared(count: number, log: unknown[]): Cursor { return model(count, log); }
class Source { static open(count: number, log: unknown[]): Cursor { return model(count, log); } }
const makers: Factory[] = [declared, Source.open];
const identity = { id: 43 };
for (const make of makers) for (const count of [0, 1, 3]) for (const explicit of [false, true]) {
  const log: unknown[] = [], seen: object[] = [], pair: [Cursor, string] = [make(count, log), "stored"]; let step = pair[0].next(identity);
  for (let i = 0; i < count; i++) { check(step, undefined, false, seen); step = explicit ? pair[0].next(undefined) : pair[0].next(); }
  check(step, undefined, true, seen); check(pair[0].next(identity), undefined, true, seen); check(pair[0].next(), undefined, true, seen);
  const expected: unknown[] = []; for (let i = 0; i < count; i++) expected.push(undefined); assert.compareArray(log, expected); assert.sameValue(pair[1], "stored");
}
