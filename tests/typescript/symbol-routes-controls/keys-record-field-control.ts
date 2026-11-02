/*---
description: String-ID record control for A symbol-indexed record held in a class field separates same-description keys from a string with that spelling.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-record, ts-null-undefined]
---*/
// A Holder field carries mixed PropertyKey records; node keeps runtime symbol identities distinct from the string same during reads and writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second", missing = "token:missing";
interface Data { text: Record<string, number | undefined>; fields: Record<string, number | undefined>; order: string[]; }
class Holder { value: Data; constructor(value: Data) { this.value = value; } }
function makeTarget(input: number, count: number): Holder { const target = new Holder({ text: { same: 91 }, fields: {}, order: [] }); if (count > 0) write(target, first, input); if (count > 1) { target.value.order.push(second); target.value.fields[second] = undefined; } return target; }
function read(target: Holder, key: string): number | undefined { return Object.hasOwn(target.value.text, key) ? target.value.text[key] : target.value.fields[key]; }
function write(target: Holder, key: string, value: number): void { if (!target.value.order.includes(key)) target.value.order.push(key); target.value.fields[key] = value; }
function has(target: Holder, key: string): boolean { return Object.hasOwn(target.value.text, key) || target.value.order.includes(key); }
function tokens(target: Holder): string[] { return target.value.order.slice(); }
function names(target: Holder): string[] { return Object.keys(target.value.text); }
for (const input of [-0, NaN, 13]) for (const count of [0, 1, 2]) {
  const target = makeTarget(input, count); same(Object.is(first, second), false);
  same(read(target, "same"), 91); same(read(target, first), count > 0 ? input : undefined); same(read(target, second), undefined);
  same(has(target, first), count > 0); same(has(target, second), count > 1); same(has(target, missing), false);
  assert.compareArray(tokens(target), count === 0 ? [] : count === 1 ? [first] : [first, second]); assert.compareArray(names(target), ["same"]);
  write(target, second, 43); write(target, first, -0);
  same(read(target, first), -0); same(read(target, second), 43); same(read(target, "same"), 91); same(has(target, missing), false);
  assert.compareArray(tokens(target), count === 0 ? [second, first] : [first, second]); assert.compareArray(names(target), ["same"]);
}
