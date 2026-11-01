/*---
description: Control for generator-yield-array-field; the same protocol steps are explicit.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-numbers, ts-strings]
---*/
// Control: explicit protocol calls keep the same values, arguments, event order and final state.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface ArraySource { values: RouteValue[]; }
interface CompletionState { value: unknown; finished: number; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function* expand(holder: ArraySource, state: CompletionState, log: unknown[]): Generator<RouteValue, undefined, RouteValue> {
  const iterator = holder.values[Symbol.iterator](); let step = iterator.next(undefined);
  while (!step.done) { const sent: RouteValue = yield step.value; step = iterator.next(sent); }
  const completion: undefined = step.value; state.value = completion; state.finished++; log.push("complete", completion); return completion;
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
