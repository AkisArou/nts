/*---
description: Control for generator-yield-user-return-union; the same protocol steps are explicit.
features: [ts-iterator-route-generators, ts-iteration, ts-generators, ts-interfaces, ts-unions, ts-arrays, ts-class, ts-symbols, ts-objects]
---*/
// Control: explicit protocol calls keep the same values, arguments, event order and final state.
type RouteValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: RouteValue[] = [-0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", undefined, identity];
interface CompletionState { value: unknown; finished: number; }
class UserCursor implements IterableIterator<RouteValue, RouteValue, RouteValue> {
  values: RouteValue[]; result: RouteValue; log: unknown[]; index: number = 0; held: RouteValue = "unset"; closed: number = 0;
  constructor(values: RouteValue[], result: RouteValue, log: unknown[]) { this.values = values; this.result = result; this.log = log; }
  [Symbol.iterator](): IterableIterator<RouteValue, RouteValue, RouteValue> { this.log.push("iterator"); return this; }
  next(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.held = value; this.log.push("next", arguments.length, value); return this.index < this.values.length ? { done: false, value: this.values[this.index++] } : { done: true, value: this.result }; }
  return(value?: RouteValue): IteratorResult<RouteValue, RouteValue> { this.closed++; this.log.push("return", arguments.length, value); return { done: true, value }; }
  throw(error?: unknown): IteratorResult<RouteValue, RouteValue> { this.log.push("throw", arguments.length, error); throw error; }
}
interface UserSource { iterable: Iterable<RouteValue, RouteValue, RouteValue>; }
function* expand(holder: UserSource, state: CompletionState, log: unknown[]): Generator<RouteValue, RouteValue, RouteValue> {
  const iterator = holder.iterable[Symbol.iterator](); let step = iterator.next(undefined);
  while (!step.done) { const sent: RouteValue = yield step.value; step = iterator.next(sent); }
  const result: RouteValue = step.value; state.value = result; state.finished++; log.push("complete", result); return result;
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
for (const input of inputs) for (const count of [0, 1, 3]) {
  const values: RouteValue[] = []; for (let i = 0; i < count; i++) values.push(i === 1 ? undefined : identity);
  const log: unknown[] = [], state: CompletionState = { value: "unset", finished: 0 }, source = new UserCursor(values, input, log);
  const holder: UserSource = { iterable: source }, iterator = expand(holder, state, log);
  log.push("call:next", "ignored"); let step = iterator.next("ignored"); const out: RouteValue[] = [];
  while (!step.done) { out.push(step.value); log.push("take", step.value); log.push("call:next", input); step = iterator.next(input); }
  log.push("done", step.value); const expected: unknown[] = ["call:next", "ignored", "iterator", "next", 1, undefined];
  for (const value of values) expected.push("take", value, "call:next", input, "next", 1, input);
  expected.push("complete", input, "done", input);
  assert.compareArray(out, values); assert.compareArray(log, expected); same(step.value, input); same(state.value, input);
  same(source.held, count === 0 ? undefined : input); assert.sameValue(source.index, count); assert.sameValue(source.closed, 0); assert.sameValue(state.finished, 1);
}
