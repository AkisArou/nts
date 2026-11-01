/*---
description: Delegated typed generator next arguments preserve mixed values and the final held value.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-class, ts-symbols, ts-numbers, ts-strings]
---*/
// Route: a Generator with union yield, return and next types is driven through yield*; node ignores the first send and forwards every later value.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface GeneratorState { last: RouteValue; resumed: number; closed: number; }
class GeneratorProbe implements IterableIterator<RouteValue, RouteValue, RouteValue> {
  inner: Generator<RouteValue, RouteValue, RouteValue>; log: unknown[];
  constructor(inner: Generator<RouteValue, RouteValue, RouteValue>, log: unknown[]) { this.inner = inner; this.log = log; }
  [Symbol.iterator](): GeneratorProbe { this.log.push("iterator"); return this; }
  next(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.log.push("next", arguments.length, value); return this.inner.next(value); }
  return(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.log.push("return", arguments.length, value); return this.inner.return(value); }
  throw(error?: unknown): IteratorResult<RouteValue, RouteValue> { this.log.push("throw", arguments.length, error); return this.inner.throw(error); }
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function* produce(values: RouteValue[], state: GeneratorState, log: unknown[]): Generator<RouteValue, RouteValue, RouteValue> {
  try { for (const value of values) { state.last = value; log.push("yield", value); state.last = yield value; state.resumed++; log.push("sent", state.last); } return state.last; }
  finally { state.closed++; log.push("finally", state.last); }
}
function* delegate(source: GeneratorProbe): Generator<RouteValue, RouteValue, RouteValue> { return yield* source; }
for (const input of inputs) for (const count of [0, 1, 3]) {
  const values: RouteValue[] = []; for (let i = 0; i < count; i++) values.push(i === 1 ? undefined : input);
  const state: GeneratorState = { last: "seed", resumed: 0, closed: 0 }, log: unknown[] = [];
  const source = new GeneratorProbe(produce(values, state, log), log), iterator = delegate(source);
  log.push("call:next", "ignored"); let step = iterator.next("ignored");
  const out: RouteValue[] = [];
  while (!step.done) { out.push(step.value); log.push("take", step.value); log.push("call:next", input); step = iterator.next(input); }
  log.push("done", step.value); const held = count === 0 ? "seed" : input;
  const expected: unknown[] = ["call:next", "ignored", "iterator", "next", 1, undefined];
  for (const value of values) expected.push("yield", value, "take", value, "call:next", input, "next", 1, input, "sent", input);
  expected.push("finally", held, "done", held);
  assert.compareArray(out, values); assert.compareArray(log, expected); same(step.value, held); same(state.last, held);
  assert.sameValue(state.resumed, count); assert.sameValue(state.closed, 1);
}
