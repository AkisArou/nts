/*---
description: "Map constructor writes precede fields in three subclass layouts."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-builtin-subclass, ts-map-set, ts-override, ts-this-type, ts-tuples]
---*/
// Three Map layouts receive constructor iterable writes before tag exists; the base view preserves exact contents and later subclass fields.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
class LayoutMap extends Map<string, BuiltinValue> { tag: string = ""; override set(key: string, value: BuiltinValue): this { log.push(this, key, value, "tag" in this, this.tag); return super.set(key, value); } }
class NumberMap extends LayoutMap { num: number = -0; }
class ReferenceMap extends LayoutMap { ref: BuiltinPoint | undefined = undefined; }
function inspect(value: Map<string, BuiltinValue>, kind: number, row: BuiltinRow): void {
  if (!(value instanceof LayoutMap)) throw new Error("lost layout");
  same(value.tag, ""); same("tag" in value, true); same(value instanceof Map, true); same(value instanceof LayoutMap, true);
  same(value instanceof NumberMap, kind === 1); same(value instanceof ReferenceMap, kind === 2); same("num" in value, kind === 1); same("ref" in value, kind === 2);
  if (value instanceof NumberMap) { same(value.num, -0); value.num = row.num; same(value.num, row.num); }
  if (value instanceof ReferenceMap) { same(value.ref, undefined); value.ref = row.ref; same(value.ref, row.ref); }
}
const types: (typeof LayoutMap)[] = [LayoutMap, NumberMap, ReferenceMap];
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index); const input: [string, BuiltinValue][] = [["a", row.value], ["a", row.ref], ["b", row.value]];
  for (let kind = 0; kind < types.length; kind++) {
    log.length = 0; const Type = types[kind], original = new Type(input), view: Map<string, BuiltinValue> = original;
    assert.compareArray(log, [original, "a", row.value, false, undefined, original, "a", row.ref, false, undefined, original, "b", row.value, false, undefined]); inspect(view, kind, row); same(view.size, 2); same(view.get("a"), row.ref); same(view.get("b"), row.value); same(view.has("b"), true); same(view.get("missing"), undefined); same(view.has("missing"), false);
    log.length = 0; view.set("b", row.ref); same(original.get("b"), row.ref); assert.compareArray(log, [original, "b", row.ref, true, ""]); same(view, original);
  }
}
