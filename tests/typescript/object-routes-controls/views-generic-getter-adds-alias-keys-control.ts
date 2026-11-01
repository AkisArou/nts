/*---
description: "Control for views-generic-getter-adds-alias-keys; A generic read invokes an own getter whose retained Record alias adds keys and changes a later field read."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-optional-properties, ts-closures]
---*/
// Generic p then tail reads share a Record with the getter; node keeps the original key snapshot and exposes newly added integer and string keys afterward. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type AddedCell = { p: ViewValue; tail: ViewValue; "2": ViewValue; "3"?: ViewValue; extra?: ViewValue; maybe?: ViewValue };
function inspect(input: ViewValue, accessor: boolean, present: boolean): void {
  const log: unknown[] = [], source: AddedCell = { p: input, tail: marker, "2": input }; let hasMaybe = false, added = false;
  if (present) { source.maybe = undefined; hasMaybe = true; }
  const table = source; same(table, source);
  function readP(): ViewValue { if (accessor) { log.push("get.p", source.p); source["3"] = marker; log.push("add.3", source["3"]); source.extra = replacement; log.push("add.extra", source.extra); source.tail = source.p; added = true; } return source.p; }
  const before = ["2", "p", "tail"]; if (hasMaybe) before.push("maybe"); const actual = [readP(), source.tail]; log.push("read", actual[0], actual[1]);
  const beforeKeys = ["2", "p", "tail"]; if (present) beforeKeys.push("maybe"); assert.compareArray(before, beforeKeys);
  const afterKeys = ["2"]; if (accessor) afterKeys.push("3"); afterKeys.push("p", "tail"); if (present) afterKeys.push("maybe"); if (accessor) afterKeys.push("extra");
  order(source, afterKeys); same(actual[0], input); same(actual[1], accessor ? input : marker); same(source.tail, accessor ? input : marker);
  same(source["3"], accessor ? marker : undefined); same(source.extra, accessor ? replacement : undefined); same(added, accessor); same(added, accessor); same(hasMaybe, present);
  let expected: unknown[] = ["read", input, marker]; if (accessor) expected = ["get.p", input, "add.3", marker, "add.extra", replacement, "read", input, input];
  same(source["2"], input); same(source.maybe, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) for (const accessor of [false, true]) for (const present of [false, true]) inspect(input, accessor, present);
