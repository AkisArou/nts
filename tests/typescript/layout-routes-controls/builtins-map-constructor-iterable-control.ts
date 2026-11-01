/*---
description: "Control for builtins-map-constructor-iterable; hold the builtin beside explicit kind and data fields."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-properties, ts-map-set, ts-tuples]
---*/
// A plain record holds the native Map; explicit constructor writes precede data fields and forward the same later operation.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutMap = { kind: number; value: Map<string, BuiltinValue>; tag?: string; num?: number; ref?: BuiltinPoint };
const log: unknown[] = [];
function write(record: LayoutMap, key: string, value: BuiltinValue): void { log.push(record, key, value, "tag" in record, record.tag); record.value.set(key, value); }
function make(kind: number, input: [string, BuiltinValue][]): LayoutMap {
  const record: LayoutMap = { kind, value: new Map<string, BuiltinValue>() }; for (const [key, value] of input) write(record, key, value);
  record.tag = ""; if (kind === 1) record.num = -0; if (kind === 2) record.ref = undefined; return record;
}
function inspect(value: LayoutMap, kind: number, row: BuiltinRow): void {
  if (!(value.kind >= 0 && value.kind <= 2)) throw new Error("lost layout");
  same(value.tag, ""); same("tag" in value, true); same(value.kind >= 0 && value.kind <= 2, true); same(value.kind >= 0 && value.kind <= 2, true);
  same(value.kind === 1, kind === 1); same(value.kind === 2, kind === 2); same("num" in value, kind === 1); same("ref" in value, kind === 2);
  if (value.kind === 1) { same(value.num, -0); value.num = row.num; same(value.num, row.num); }
  if (value.kind === 2) { same(value.ref, undefined); value.ref = row.ref; same(value.ref, row.ref); }
}
for (let index = 0; index < payloads.length; index++) {
  const row = rowFor(payloads[index], index); const input: [string, BuiltinValue][] = [["a", row.value], ["a", row.ref], ["b", row.value]];
  for (let kind = 0; kind < 3; kind++) {
    log.length = 0; const original = make(kind, input), view: Map<string, BuiltinValue> = original.value;
    assert.compareArray(log, [original, "a", row.value, false, undefined, original, "a", row.ref, false, undefined, original, "b", row.value, false, undefined]); inspect(original, kind, row); same(view.size, 2); same(view.get("a"), row.ref); same(view.get("b"), row.value); same(view.has("b"), true); same(view.get("missing"), undefined); same(view.has("missing"), false);
    log.length = 0; write(original, "b", row.ref); same(original.value.get("b"), row.ref); assert.compareArray(log, [original, "b", row.ref, true, ""]); same(view, original.value);
  }
}
