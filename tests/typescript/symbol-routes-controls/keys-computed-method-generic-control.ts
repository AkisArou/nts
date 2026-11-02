/*---
description: String-ID record control for A generic constraint dispatches a computed symbol method on literal and class receivers.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-generics]
---*/
// An Action constraint carries a computed method; node binds this to each literal or class receiver and never confuses an equal-description key.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const call = "token:call", missing = "token:missing";
interface Action { data: { value: number }; operations: Record<string, (target: Action, delta: number) => number>; order: string[]; }
function update(target: Action, delta: number): number { target.data.value += delta; return target.data.value; }
function makeTarget(input: number, kind: string): Action { return { data: { value: input }, operations: { [call]: update }, order: kind === "class" ? [] : [call] }; }
function invoke<T extends Action>(target: T, delta: number): number { return target.operations[call](target, delta); }
function state(target: Action): number { return target.data.value; }
function has(target: Action, key: string): boolean { return Object.hasOwn(target.operations, key); }
function tokens(target: Action): string[] { return target.order.slice(); }
function names(target: Action): string[] { return Object.keys(target.data); }
for (const input of [-3, 0, 12]) for (const kind of ["literal", "class"]) {
  const target = makeTarget(input, kind), other = makeTarget(71, kind); let expected = input;
  same(has(target, call), true); same(has(target, missing), false); same(Object.is(call, missing), false);
  assert.compareArray(tokens(target), kind === "class" ? [] : [call]); assert.compareArray(names(target), ["value"]);
  for (const delta of [0, 2, -5]) { expected += delta; same(invoke(target, delta), expected); same(state(target), expected); same(state(other), 71); }
  same(has(target, missing), false); assert.compareArray(tokens(target), kind === "class" ? [] : [call]); assert.compareArray(names(target), ["value"]);
}
