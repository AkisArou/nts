/*---
description: "Error base views preserve cause identity and three sets of subclass fields."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-builtin-subclass, ts-errors, ts-override]
---*/
// Three Error layouts cross an Error parameter; node retains names, messages, causes, own fields and both directions of writes.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class LayoutError extends Error { override name: string = "LayoutError"; code: number; constructor(row: BuiltinRow) { super(row.text, { cause: row.value }); this.code = row.num; } }
class LayoutTextError extends LayoutError { detail: string; constructor(row: BuiltinRow) { super(row); this.detail = row.text; } }
class LayoutRefError extends LayoutError { ref: BuiltinPoint; constructor(row: BuiltinRow) { super(row); this.ref = row.ref; } }
function inspect(value: Error, row: BuiltinRow, kind: number, cause: BuiltinValue, message: string): void {
  same(value.name, "LayoutError"); same(value.message, message); same(value.cause, cause); same("cause" in value, true);
  same(value instanceof Error, true); same(value instanceof LayoutError, true); same(value instanceof LayoutTextError, kind === 1); same(value instanceof LayoutRefError, kind === 2);
  if (!(value instanceof LayoutError)) throw new Error("missing layout"); same(value.code, row.num); same("code" in value, true);
  same("detail" in value, kind === 1); same("ref" in value, kind === 2); same("missing" in value, false);
  if (value instanceof LayoutTextError) same(value.detail, row.text); if (value instanceof LayoutRefError) same(value.ref, row.ref);
}
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index), originals: LayoutError[] = [new LayoutError(row), new LayoutTextError(row), new LayoutRefError(row)];
  for (let kind = 0; kind < originals.length; kind++) {
    const original = originals[kind], view: Error = original; inspect(view, row, kind, row.value, row.text);
    view.cause = row.ref; view.message = row.text + "!"; same(original.cause, row.ref); same(original.message, row.text + "!");
    original.cause = row.value; original.message = row.text; inspect(view, row, kind, row.value, row.text); same(view, original);
  }
}
