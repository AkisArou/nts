/*---
description: Computed class fields retain distinct symbols and exact values through typed array elements.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-symbols, ts-computed-keys, ts-unique-symbol]
---*/
// A Store array carries two same-description instance fields; node writes each field independently and preserves the other array element.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const left: unique symbol = Symbol("value"), right: unique symbol = Symbol("value");
class Store { [left]: number; [right]: number; constructor(a: number, b: number) { this[left] = a; this[right] = b; } }
function makeTarget(a: number, b: number): Store { return new Store(a, b); }
function read(items: Store[], index: number, key: typeof left | typeof right): number { return items[index][key]; }
function write(items: Store[], index: number, key: typeof left | typeof right, value: number): void { items[index][key] = value; }
function tokens(target: Store): symbol[] { return Object.getOwnPropertySymbols(target); }
function names(target: Store): string[] { return Object.keys(target); }
for (const input of [-0, NaN, 19]) {
  const items: Store[] = [makeTarget(input, 11), makeTarget(-0, NaN)]; same(Object.is(left, right), false);
  same(read(items, 0, left), input); same(read(items, 0, right), 11); same(read(items, 1, left), -0); same(read(items, 1, right), NaN);
  write(items, 0, left, 37); same(read(items, 0, left), 37); same(read(items, 0, right), 11); same(read(items, 1, left), -0); same(read(items, 1, right), NaN);
  write(items, 1, right, 41); same(read(items, 1, right), 41); same(read(items, 1, left), -0); same(read(items, 0, right), 11); same(read(items, 0, left), 37);
  for (const target of items) { assert.compareArray(tokens(target), [left, right]); assert.compareArray(names(target), []); }
}
