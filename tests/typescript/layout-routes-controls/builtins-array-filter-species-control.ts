/*---
description: "Control for builtins-array-filter-species; hold the builtin beside explicit kind and data fields."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-properties, ts-arrow-functions]
---*/
// A plain record holds the native array and kind; explicitly build the output record and forward filter to its native array.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutArray = { kind: number; value: BuiltinValue[]; marker: BuiltinPoint; num?: number; label?: string };
function make(kind: number): LayoutArray {
  if (kind === 1) return { kind, value: [], marker: refs[0], num: -0 };
  if (kind === 2) return { kind, value: [], marker: refs[0], label: "" }; return { kind, value: [], marker: refs[0] };
}
function inspect(value: LayoutArray, kind: number, marker: BuiltinPoint): void {
  if (!(value.kind >= 0 && value.kind <= 2)) throw new Error("lost layout");
  same(Array.isArray(value.value), true); same(value.marker, marker); same("marker" in value, true); same(value.kind >= 0 && value.kind <= 2, true); same(value.kind >= 0 && value.kind <= 2, true);
  same(value.kind === 1, kind === 1); same(value.kind === 2, kind === 2); same("num" in value, kind === 1); same("label" in value, kind === 2);
  if (value.kind === 1) same(value.num, -0); if (value.kind === 2) same(value.label, "");
}
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index);
  for (let kind = 0; kind < 3; kind++) {
    const original = make(kind), view: BuiltinValue[] = original.value; original.marker = row.ref;
    same(view.length, 0); same(view.push(row.value, row.ref), 2); same(view.length, 2); same(view[0], row.value); same(view[1], row.ref); inspect(original, kind, row.ref);
    const result = make(kind); result.value = view.filter((value, index) => index === 1 || value !== undefined); const expected: BuiltinValue[] = row.value === undefined ? [row.ref] : [row.value, row.ref];
    same(Object.is(result, original), false); same(Object.is(result.value, original.value), false); inspect(result, kind, refs[0]);
    same(result.value.length, expected.length); for (let slot = 0; slot < expected.length; slot++) same(result.value[slot], expected[slot]);
    result.value[0] = row.ref; same(original.value[0], row.value); same(original.value[1], row.ref); same(original.marker, row.ref); same(view, original.value);
  }
}
