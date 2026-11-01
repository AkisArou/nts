/*---
description: Delegation to a typed generator retains its distinct completion object by identity.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-objects]
---*/
// Route: a generator returning a typed object is delegated through a Generator parameter; node keeps that return object distinct from every yielded value.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface ReturnValue { id: number; count: number; last: RouteValue; }
interface ReturnState { held: ReturnValue | undefined; finished: number; }
function* produce(values: RouteValue[], result: ReturnValue, state: ReturnState, log: unknown[]): Generator<RouteValue, ReturnValue, undefined> {
  for (const value of values) { log.push("yield", value); const sent: undefined = yield value; log.push("resume", sent); } state.finished++; log.push("finish", result); return result;
}
function* expand(source: Generator<RouteValue, ReturnValue, undefined>, state: ReturnState, log: unknown[]): Generator<RouteValue, ReturnValue, undefined> {
  const result: ReturnValue = yield* source; state.held = result; log.push("complete", result); return result;
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
for (const input of inputs) for (const count of [0, 1, 3]) {
  const values: RouteValue[] = []; for (let i = 0; i < count; i++) values.push(i === 1 ? undefined : input);
  const result: ReturnValue = { id: 99, count, last: input }, state: ReturnState = { held: undefined, finished: 0 }, log: unknown[] = [];
  const source = produce(values, result, state, log), iterator = expand(source, state, log);
  log.push("call:next", undefined); let step = iterator.next(undefined); const out: RouteValue[] = [];
  while (!step.done) { out.push(step.value); log.push("take", step.value); log.push("call:next", undefined); step = iterator.next(undefined); }
  log.push("done", step.value); const expected: unknown[] = ["call:next", undefined];
  for (const value of values) expected.push("yield", value, "take", value, "call:next", undefined, "resume", undefined);
  expected.push("finish", result, "complete", result, "done", result);
  assert.compareArray(out, values); assert.compareArray(log, expected); same(step.value, result); same(state.held, result);
  assert.sameValue(state.finished, 1); assert.sameValue(result.count, count); same(result.last, input);
}
