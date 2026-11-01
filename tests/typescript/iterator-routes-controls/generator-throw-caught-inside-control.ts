/*---
description: Control for generator-throw-caught-inside; the same protocol steps are explicit.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-class, ts-symbols, ts-errors]
---*/
// Control: explicit protocol calls keep the same values, arguments, event order and final state.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface RecoveryState { last: RouteValue; caught: unknown; closed: number; }
class GeneratorProbe implements IterableIterator<RouteValue, RouteValue, RouteValue> {
  inner: Generator<RouteValue, RouteValue, RouteValue>; log: unknown[];
  constructor(inner: Generator<RouteValue, RouteValue, RouteValue>, log: unknown[]) { this.inner = inner; this.log = log; }
  [Symbol.iterator](): GeneratorProbe { this.log.push("iterator"); return this; }
  next(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.log.push("next", arguments.length, value); return this.inner.next(value); }
  return(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.log.push("return", arguments.length, value); return this.inner.return(value); }
  throw(error?: unknown): IteratorResult<RouteValue, RouteValue> { this.log.push("throw", arguments.length, error); return this.inner.throw(error); }
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function* recover(values: RouteValue[], state: RecoveryState, log: unknown[], failure: RangeError): Generator<RouteValue, RouteValue, RouteValue> {
  try { for (const value of values) {
    state.last = value; log.push("yield", value);
    try { state.last = yield value; log.push("sent", state.last); }
    catch (error: unknown) { log.push("caught", error); same(error, failure); assert.sameValue(error instanceof RangeError, true); if (!(error instanceof RangeError)) throw new Error("wrong error"); assert.sameValue(error.message, "recover"); state.caught = error; log.push("yield", "recovered"); state.last = yield "recovered"; log.push("sent", state.last); }
  } return state.last; } finally { state.closed++; log.push("finally", state.last); }
}
for (const input of inputs) for (const count of [0, 1, 3]) {
  const values: RouteValue[] = []; for (let i = 0; i < count; i++) values.push(i === 1 ? undefined : input);
  const state: RecoveryState = { last: "seed", caught: undefined, closed: 0 }, log: unknown[] = [], failure = new RangeError("recover");
  const source = new GeneratorProbe(recover(values, state, log, failure), log);
  log.push("call:next", "ignored"); const iterator = source[Symbol.iterator](); let step = iterator.next(undefined), injected = false;
  const out: RouteValue[] = [];
  while (!step.done) {
    out.push(step.value); log.push("take", step.value);
    if (!injected) { injected = true; log.push("call:throw", failure); step = iterator.throw(failure); }
    else { log.push("call:next", input); step = iterator.next(input); }
  }
  const held = count === 0 ? "seed" : input; log.push("done", step.value);
  const expected: unknown[] = ["call:next", "ignored", "iterator", "next", 1, undefined], delivered: RouteValue[] = [];
  for (let i = 0; i < count; i++) { expected.push("yield", values[i], "take", values[i]); delivered.push(values[i]);
    if (i === 0) { expected.push("call:throw", failure, "throw", 1, failure, "caught", failure, "yield", "recovered", "take", "recovered"); delivered.push("recovered"); }
    expected.push("call:next", input, "next", 1, input, "sent", input);
  }
  expected.push("finally", held, "done", held); assert.compareArray(out, delivered); assert.compareArray(log, expected);
  same(step.value, held); same(state.last, held); same(state.caught, count === 0 ? undefined : failure); assert.sameValue(state.closed, 1);
}
