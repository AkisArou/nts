/*---
description: "Set constructor writes precede fields in three subclass layouts."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-builtin-subclass, ts-map-set, ts-override, ts-this-type]
---*/
// Three Set layouts receive constructor iterable writes before tag exists; the base view preserves exact contents and later subclass fields.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
class LayoutSet extends Set<BuiltinValue> { tag: string = ""; override add(value: BuiltinValue): this { log.push(this, value, "tag" in this, this.tag); return super.add(value); } }
class NumberSet extends LayoutSet { num: number = -0; }
class ReferenceSet extends LayoutSet { ref: BuiltinPoint | undefined = undefined; }
function inspect(value: Set<BuiltinValue>, kind: number, row: BuiltinRow): void {
  if (!(value instanceof LayoutSet)) throw new Error("lost layout");
  same(value.tag, ""); same("tag" in value, true); same(value instanceof Set, true); same(value instanceof LayoutSet, true);
  same(value instanceof NumberSet, kind === 1); same(value instanceof ReferenceSet, kind === 2); same("num" in value, kind === 1); same("ref" in value, kind === 2);
  if (value instanceof NumberSet) { same(value.num, -0); value.num = row.num; same(value.num, row.num); }
  if (value instanceof ReferenceSet) { same(value.ref, undefined); value.ref = row.ref; same(value.ref, row.ref); }
}
const types: (typeof LayoutSet)[] = [LayoutSet, NumberSet, ReferenceSet];
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index); const input: BuiltinValue[] = [row.value, row.ref, row.value];
  for (let kind = 0; kind < types.length; kind++) {
    log.length = 0; const Type = types[kind], original = new Type(input), view: Set<BuiltinValue> = original;
    assert.compareArray(log, [original, row.value, false, undefined, original, row.ref, false, undefined, original, row.value, false, undefined]); inspect(view, kind, row); const values = Array.from(view); same(view.size, 2); same(values.length, 2); same(values[0], Object.is(row.value, -0) ? 0 : row.value); same(values[1], row.ref); same(view.has(row.value), true);
    log.length = 0; view.add(row.ref); same(original.size, 2); assert.compareArray(log, [original, row.ref, true, ""]); same(view, original);
  }
}
