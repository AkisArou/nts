/*---
description: "Three Array layouts retain data through map and a base array view."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-builtin-subclass, ts-arrow-functions]
---*/
// Three Array layouts cross an array view; node preserves contents and map creates the same subclass with freshly initialized own fields.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class LayoutArray extends Array<BuiltinValue> { marker: BuiltinPoint = refs[0]; }
class NumberArray extends LayoutArray { num: number = -0; }
class TextArray extends LayoutArray { label: string = ""; }
function inspect(value: BuiltinValue[], kind: number, marker: BuiltinPoint): void {
  if (!(value instanceof LayoutArray)) throw new Error("lost layout");
  same(Array.isArray(value), true); same(value.marker, marker); same("marker" in value, true); same(value instanceof Array, true); same(value instanceof LayoutArray, true);
  same(value instanceof NumberArray, kind === 1); same(value instanceof TextArray, kind === 2); same("num" in value, kind === 1); same("label" in value, kind === 2);
  if (value instanceof NumberArray) same(value.num, -0); if (value instanceof TextArray) same(value.label, "");
}
const types: (typeof LayoutArray)[] = [LayoutArray, NumberArray, TextArray];
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index);
  for (let kind = 0; kind < types.length; kind++) {
    const Type = types[kind], original = new Type(), view: BuiltinValue[] = original; original.marker = row.ref;
    same(view.length, 0); same(view.push(row.value, row.ref), 2); same(view.length, 2); same(view[0], row.value); same(view[1], row.ref); inspect(view, kind, row.ref);
    const result = view.map(value => value), expected: BuiltinValue[] = [row.value, row.ref];
    same(Object.is(result, original), false); if (!(result instanceof LayoutArray)) throw new Error("lost species"); inspect(result, kind, refs[0]);
    same(result.length, expected.length); for (let slot = 0; slot < expected.length; slot++) same(result[slot], expected[slot]);
    result[0] = row.ref; same(original[0], row.value); same(original[1], row.ref); same(original.marker, row.ref); same(view, original);
  }
}
