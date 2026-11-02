/*---
description: Computed static fields read and write through a declared constructor-state interface.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-static, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A StaticState parameter carries class constructors with same-description static slots; node preserves independent class storage and symbol order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first: unique symbol = Symbol("state"), second: unique symbol = Symbol("state"), missing: unique symbol = Symbol("state");
interface StaticState { [first]: number; [second]: number; }
function makeTarget(input: number): StaticState { class State { static [first]: number = input; static [second]: number = 17; } return State; }
function read(target: StaticState, key: typeof first | typeof second): number { return target[key]; }
function write(target: StaticState, key: typeof first | typeof second, value: number): void { target[key] = value; }
function has(target: StaticState, key: symbol): boolean { return key in target; }
function tokens(target: StaticState): symbol[] { return Object.getOwnPropertySymbols(target); }
for (const input of [-0, NaN, 31]) {
  const target = makeTarget(input), other = makeTarget(input); same(Object.is(first, second), false);
  same(read(target, first), input); same(read(target, second), 17); same(has(target, first), true); same(has(target, second), true); same(has(target, missing), false);
  write(target, first, 53); same(read(target, first), 53); same(read(target, second), 17); same(read(other, first), input);
  write(target, second, -0); same(read(target, second), -0); same(read(target, first), 53); same(read(other, second), 17);
  assert.compareArray(tokens(target), [first, second]); assert.compareArray(tokens(other), [first, second]);
}
