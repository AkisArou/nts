/*---
description: "Control for builtins-error-base-payload; hold the builtin beside explicit kind and data fields."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-properties, ts-errors]
---*/
// Plain data records hold Error values; kind supplies the original class memberships and ordinary fields retain subclass data.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutError = { kind: number; value: Error; code: number; detail?: string; ref?: BuiltinPoint };
function make(row: BuiltinRow, kind: number): LayoutError {
  const value = new Error(row.text, { cause: row.value }); value.name = "LayoutError";
  if (kind === 1) return { kind, value, code: row.num, detail: row.text };
  if (kind === 2) return { kind, value, code: row.num, ref: row.ref }; return { kind, value, code: row.num };
}
function inspect(value: LayoutError, row: BuiltinRow, kind: number, cause: BuiltinValue, message: string): void {
  same(value.value.name, "LayoutError"); same(value.value.message, message); same(value.value.cause, cause); same("cause" in value.value, true);
  same(value.kind >= 0 && value.kind <= 2, true); same(value.kind >= 0 && value.kind <= 2, true); same(value.kind === 1, kind === 1); same(value.kind === 2, kind === 2);
  same(value.code, row.num); same("code" in value, true); same("detail" in value, kind === 1); same("ref" in value, kind === 2); same("missing" in value, false);
  if (value.kind === 1) same(value.detail, row.text); if (value.kind === 2) same(value.ref, row.ref);
}
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index), originals: LayoutError[] = [make(row, 0), make(row, 1), make(row, 2)];
  for (let kind = 0; kind < originals.length; kind++) {
    const original = originals[kind], view: LayoutError = original; inspect(view, row, kind, row.value, row.text);
    view.value.cause = row.ref; view.value.message = row.text + "!"; same(original.value.cause, row.ref); same(original.value.message, row.text + "!");
    original.value.cause = row.value; original.value.message = row.text; inspect(view, row, kind, row.value, row.text); same(view, original);
  }
}
