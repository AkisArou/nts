/*---
description: "A generic read invokes an own getter whose retained Record alias adds keys and changes a later field read."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-index-signatures, ts-record, ts-generics, ts-generic-constraints, ts-accessors, ts-optional-properties, ts-closures]
---*/
// Generic p then tail reads share a Record with the getter; node keeps the original key snapshot and exposes newly added integer and string keys afterward.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface AddedView { [key: string]: ViewValue; p: ViewValue; tail: ViewValue; "2": ViewValue; maybe?: ViewValue }
function read<T extends AddedView>(value: T): ViewValue[] { return [value.p, value.tail]; }
function inspect(input: ViewValue, accessor: boolean, present: boolean): void {
  const log: unknown[] = [];
  const source: AddedView = accessor ? { get p(): ViewValue { log.push("get.p", input); table["3"] = marker; log.push("add.3", table["3"]); table.extra = replacement; log.push("add.extra", table.extra); table.tail = input; return input; }, tail: marker, "2": input } : { p: input, tail: marker, "2": input };
  if (present) source.maybe = undefined;
  const table: Record<string, ViewValue> = source; same(table, source);
  const before = Object.keys(source), actual = read(source); log.push("read", actual[0], actual[1]);
  const beforeKeys = ["2", "p", "tail"]; if (present) beforeKeys.push("maybe"); assert.compareArray(before, beforeKeys);
  const afterKeys = ["2"]; if (accessor) afterKeys.push("3"); afterKeys.push("p", "tail"); if (present) afterKeys.push("maybe"); if (accessor) afterKeys.push("extra");
  order(source, afterKeys); same(actual[0], input); same(actual[1], accessor ? input : marker); same(source.tail, accessor ? input : marker);
  same(table["3"], accessor ? marker : undefined); same(table.extra, accessor ? replacement : undefined); same(Object.hasOwn(source, "3"), accessor); same(Object.hasOwn(source, "extra"), accessor); same(Object.hasOwn(source, "maybe"), present);
  let expected: unknown[] = ["read", input, marker]; if (accessor) expected = ["get.p", input, "add.3", marker, "add.extra", replacement, "read", input, input];
  same(source["2"], input); same(source.maybe, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) for (const accessor of [false, true]) for (const present of [false, true]) inspect(input, accessor, present);
