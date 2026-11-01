/*---
description: A delegated return stays pending while the inner generator yields from finally and receives another value.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-class, ts-symbols, ts-errors]
---*/
// Route: a typed generator yields cleanup during return(value); node keeps the pending return value while finally receives the later next value.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface CleanupState { held: RouteValue; entered: number; finished: number; }
class GeneratorProbe implements IterableIterator<RouteValue, RouteValue, RouteValue> {
  inner: Generator<RouteValue, RouteValue, RouteValue>; log: unknown[];
  constructor(inner: Generator<RouteValue, RouteValue, RouteValue>, log: unknown[]) { this.inner = inner; this.log = log; }
  [Symbol.iterator](): GeneratorProbe { this.log.push("iterator"); return this; }
  next(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.log.push("next", arguments.length, value); return this.inner.next(value); }
  return(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.log.push("return", arguments.length, value); return this.inner.return(value); }
  throw(error?: unknown): IteratorResult<RouteValue, RouteValue> { this.log.push("throw", arguments.length, error); return this.inner.throw(error); }
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function* cleanupYield(values: RouteValue[], state: CleanupState, log: unknown[]): Generator<RouteValue, RouteValue, RouteValue> {
  try { for (const value of values) { log.push("yield", value); yield value; } return "natural"; }
  finally { state.entered++; log.push("finally:enter"); state.held = yield "cleanup"; state.finished++; log.push("finally:sent", state.held); }
}
function* delegate(source: GeneratorProbe): Generator<RouteValue, RouteValue, RouteValue> { return yield* source; }
for (const input of inputs) for (const count of [0, 1, 3]) {
  const values: RouteValue[] = []; for (let i = 0; i < count; i++) values.push("body");
  const state: CleanupState = { held: "seed", entered: 0, finished: 0 }, log: unknown[] = [];
  const source = new GeneratorProbe(cleanupYield(values, state, log), log), iterator = delegate(source);
  log.push("call:next", "ignored"); const first = iterator.next("ignored");
  assert.sameValue(first.done, false); same(first.value, count === 0 ? "cleanup" : "body"); log.push("take", first.value);
  log.push("call:return", input); let step = iterator.return(input);
  while (!step.done) { log.push("take", step.value); same(step.value, "cleanup"); log.push("call:next", identity); step = iterator.next(identity); }
  log.push("done", step.value); const expected: unknown[] = ["call:next", "ignored", "iterator", "next", 1, undefined];
  if (count === 0) expected.push("finally:enter", "take", "cleanup"); else expected.push("yield", "body", "take", "body");
  expected.push("call:return", input, "return", 1, input);
  if (count > 0) expected.push("finally:enter", "take", "cleanup", "call:next", identity, "next", 1, identity, "finally:sent", identity);
  expected.push("done", input); assert.compareArray(log, expected); same(step.value, input);
  same(state.held, count === 0 ? "seed" : identity); assert.sameValue(state.entered, 1); assert.sameValue(state.finished, count === 0 ? 0 : 1);
}
