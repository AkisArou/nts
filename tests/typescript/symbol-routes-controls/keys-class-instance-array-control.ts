/*---
description: String-ID record control for Computed class fields retain distinct symbols and exact values through typed array elements.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields]
---*/
// A Store array carries two same-description instance fields; node writes each field independently and preserves the other array element.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const left = "token:left", right = "token:right";
class Store { fields: Record<string, number>; order: string[]; text: Record<string, number> = {}; constructor(a: number, b: number) { this.fields = { [left]: a, [right]: b }; this.order = [left, right]; } }
function makeTarget(a: number, b: number): Store { return new Store(a, b); }
function read(items: Store[], index: number, key: typeof left | typeof right): number { return items[index].fields[key]; }
function write(items: Store[], index: number, key: typeof left | typeof right, value: number): void { items[index].fields[key] = value; }
function tokens(target: Store): string[] { return target.order.slice(); }
function names(target: Store): string[] { return Object.keys(target.text); }
for (const input of [-0, NaN, 19]) {
  const items: Store[] = [makeTarget(input, 11), makeTarget(-0, NaN)]; same(Object.is(left, right), false);
  same(read(items, 0, left), input); same(read(items, 0, right), 11); same(read(items, 1, left), -0); same(read(items, 1, right), NaN);
  write(items, 0, left, 37); same(read(items, 0, left), 37); same(read(items, 0, right), 11); same(read(items, 1, left), -0); same(read(items, 1, right), NaN);
  write(items, 1, right, 41); same(read(items, 1, right), 41); same(read(items, 1, left), -0); same(read(items, 0, right), 11); same(read(items, 0, left), 37);
  for (const target of items) { assert.compareArray(tokens(target), [left, right]); assert.compareArray(names(target), []); }
}
