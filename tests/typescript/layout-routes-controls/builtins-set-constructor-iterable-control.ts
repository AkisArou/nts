/*---
description: "Control for builtins-set-constructor-iterable; hold the builtin beside explicit kind and data fields."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-properties, ts-map-set]
---*/
// A plain record holds the native Set; explicit constructor writes precede data fields and forward the same later operation.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutSet = { kind: number; value: Set<BuiltinValue>; tag?: string; num?: number; ref?: BuiltinPoint };
const log: unknown[] = [];
function write(record: LayoutSet, value: BuiltinValue): void { log.push(record, value, "tag" in record, record.tag); record.value.add(value); }
function make(kind: number, input: BuiltinValue[]): LayoutSet {
  const record: LayoutSet = { kind, value: new Set<BuiltinValue>() }; for (const value of input) write(record, value);
  record.tag = ""; if (kind === 1) record.num = -0; if (kind === 2) record.ref = undefined; return record;
}
function inspect(value: LayoutSet, kind: number, row: BuiltinRow): void {
  if (!(value.kind >= 0 && value.kind <= 2)) throw new Error("lost layout");
  same(value.tag, ""); same("tag" in value, true); same(value.kind >= 0 && value.kind <= 2, true); same(value.kind >= 0 && value.kind <= 2, true);
  same(value.kind === 1, kind === 1); same(value.kind === 2, kind === 2); same("num" in value, kind === 1); same("ref" in value, kind === 2);
  if (value.kind === 1) { same(value.num, -0); value.num = row.num; same(value.num, row.num); }
  if (value.kind === 2) { same(value.ref, undefined); value.ref = row.ref; same(value.ref, row.ref); }
}
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index); const input: BuiltinValue[] = [row.value, row.ref, row.value];
  for (let kind = 0; kind < 3; kind++) {
    log.length = 0; const original = make(kind, input), view: Set<BuiltinValue> = original.value;
    assert.compareArray(log, [original, row.value, false, undefined, original, row.ref, false, undefined, original, row.value, false, undefined]); inspect(original, kind, row); const values = Array.from(view); same(view.size, 2); same(values.length, 2); same(values[0], Object.is(row.value, -0) ? 0 : row.value); same(values[1], row.ref); same(view.has(row.value), true);
    log.length = 0; write(original, row.ref); same(original.value.size, 2); assert.compareArray(log, [original, row.ref, true, ""]); same(view, original.value);
  }
}
