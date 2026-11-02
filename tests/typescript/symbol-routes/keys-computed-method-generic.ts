/*---
description: A generic constraint dispatches a computed symbol method on literal and class receivers.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-generics, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// An Action constraint carries a computed method; node binds this to each literal or class receiver and never confuses an equal-description key.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const call: unique symbol = Symbol("call"), missing: unique symbol = Symbol("call");
interface Action { value: number; [call](delta: number): number; }
class Counter implements Action { value: number; constructor(value: number) { this.value = value; } [call](delta: number): number { this.value += delta; return this.value; } }
function makeTarget(input: number, kind: string): Action { return kind === "class" ? new Counter(input) : { value: input, [call](delta: number): number { this.value += delta; return this.value; } }; }
function invoke<T extends Action>(target: T, delta: number): number { return target[call](delta); }
function state(target: Action): number { return target.value; }
function has(target: Action, key: symbol): boolean { return key in target; }
function tokens(target: Action): symbol[] { return Object.getOwnPropertySymbols(target); }
function names(target: Action): string[] { return Object.keys(target); }
for (const input of [-3, 0, 12]) for (const kind of ["literal", "class"]) {
  const target = makeTarget(input, kind), other = makeTarget(71, kind); let expected = input;
  same(has(target, call), true); same(has(target, missing), false); same(Object.is(call, missing), false);
  assert.compareArray(tokens(target), kind === "class" ? [] : [call]); assert.compareArray(names(target), ["value"]);
  for (const delta of [0, 2, -5]) { expected += delta; same(invoke(target, delta), expected); same(state(target), expected); same(state(other), 71); }
  same(has(target, missing), false); assert.compareArray(tokens(target), kind === "class" ? [] : [call]); assert.compareArray(names(target), ["value"]);
}
