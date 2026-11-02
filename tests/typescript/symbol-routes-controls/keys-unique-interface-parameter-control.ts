/*---
description: String-ID record control for Unique-symbol optional interface fields retain presence and separate equal-description keys through a parameter.
features: [ts-symbol-route-keys, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-type-aliases, ts-optional-properties, ts-null-undefined]
---*/
// Two unique slot keys cross a Slots parameter; node distinguishes absent, present undefined and independent writes without string keys.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const first = "token:first", second = "token:second", missing = "token:missing";
interface Slots { fields: Record<string, number | undefined>; order: string[]; text: Record<string, number>; }
type Slot = typeof first | typeof second;
function makeTarget(input: number, mode: string): Slots { const target: Slots = { fields: {}, order: [], text: {} }; if (mode === "both") write(target, second, undefined); if (mode !== "empty") write(target, first, input); return target; }
function read(target: Slots, key: Slot): number | undefined { return target.fields[key]; }
function write(target: Slots, key: Slot, value: number | undefined): void { if (!has(target, key)) target.order.push(key); target.fields[key] = value; }
function has(target: Slots, key: string): boolean { return target.order.includes(key); }
function tokens(target: Slots): string[] { return target.order.slice(); }
function names(target: Slots): string[] { return Object.keys(target.text); }
for (const input of [-0, NaN, 17]) for (const mode of ["empty", "one", "both"]) {
  const target = makeTarget(input, mode); same(Object.is(first, second), false);
  same(has(target, first), mode !== "empty"); same(has(target, second), mode === "both"); same(has(target, missing), false);
  same(read(target, first), mode === "empty" ? undefined : input); same(read(target, second), undefined);
  assert.compareArray(tokens(target), mode === "empty" ? [] : mode === "one" ? [first] : [second, first]); assert.compareArray(names(target), []);
  write(target, second, 29); same(read(target, second), 29); same(read(target, first), mode === "empty" ? undefined : input);
  write(target, first, -0); same(read(target, first), -0); same(read(target, second), 29); same(has(target, missing), false);
  assert.compareArray(tokens(target), mode === "one" ? [first, second] : [second, first]); assert.compareArray(names(target), []);
}
