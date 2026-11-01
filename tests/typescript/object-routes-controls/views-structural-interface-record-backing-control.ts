/*---
description: "Control for views-structural-interface-record-backing; Interface and Record views distinguish a data field from an own getter when writes change its backing field."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-optional-properties, ts-closures]
---*/
// Structural p is data or an accessor over raw; node exposes Record raw writes through interface reads and setter writes through Record raw readback. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type BackingCell = { raw: ViewValue; p: ViewValue; "2": ViewValue; maybe?: ViewValue };
function inspect(input: ViewValue, accessor: boolean, present: boolean): void {
  const log: unknown[] = [], source: BackingCell = { raw: input, p: input, "2": input }; let hasMaybe = false; if (present) { source.maybe = undefined; hasMaybe = true; }
  const view = source, table = source; same(view, source); same(table, source);
  function read(): ViewValue { if (accessor) { log.push("get", source.raw); return source.raw; } return source.p; }
  function write(value: ViewValue): void { if (accessor) { log.push("set", source.raw, value); source.raw = value; } else source.p = value; }
  const before = read(); log.push("before", before); source.raw = replacement;
  const changed = read(); log.push("changed", changed); write(marker);
  const backing = source.raw; log.push("backing", backing); write(input);
  const final = read(); log.push("final", final);
  same(before, input); same(changed, accessor ? replacement : input); same(backing, accessor ? marker : replacement); same(final, input); same(source.raw, accessor ? input : replacement); same(source["2"], input);
  const keys = ["2", "raw", "p"]; if (present) keys.push("maybe"); order(source, keys); same(hasMaybe, present);
  let expected: unknown[] = ["before", input, "changed", input, "backing", replacement, "final", input];
  if (accessor) expected = ["get", input, "before", input, "get", replacement, "changed", replacement, "set", replacement, marker, "backing", marker, "set", marker, input, "get", input, "final", input];
  same(source.maybe, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) for (const accessor of [false, true]) for (const present of [false, true]) inspect(input, accessor, present);
