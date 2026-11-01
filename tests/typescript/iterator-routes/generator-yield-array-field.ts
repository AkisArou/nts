/*---
description: Array delegation through a typed field preserves mixed yielded values and undefined completion.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-numbers, ts-strings]
---*/
// Route: an array in an interface field is delegated with yield*; node preserves each value and returns undefined after exhaustion.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface ArraySource { values: RouteValue[]; }
interface CompletionState { value: unknown; finished: number; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function* expand(holder: ArraySource, state: CompletionState, log: unknown[]): Generator<RouteValue, undefined, RouteValue> {
  const completion: undefined = yield* holder.values; state.value = completion; state.finished++; log.push("complete", completion); return completion;
}
for (const input of inputs) for (const count of [0, 1, 3]) {
  const values: RouteValue[] = []; for (let i = 0; i < count; i++) values.push(i === 1 ? undefined : input);
  const holder: ArraySource = { values }, state: CompletionState = { value: "unset", finished: 0 }, log: unknown[] = [];
  const iterator = expand(holder, state, log); log.push("next", "ignored"); let step = iterator.next("ignored");
  const out: RouteValue[] = [];
  while (!step.done) { out.push(step.value); log.push("take", step.value); log.push("next", input); step = iterator.next(input); }
  log.push("done", step.value); const expected: unknown[] = ["next", "ignored"];
  for (const value of values) expected.push("take", value, "next", input);
  expected.push("complete", undefined, "done", undefined);
  assert.compareArray(log, expected); assert.compareArray(out, values); same(step.value, undefined); same(state.value, undefined);
  assert.sameValue(state.finished, 1); assert.sameValue(holder.values, values); assert.sameValue(holder.values.length, count);
}
