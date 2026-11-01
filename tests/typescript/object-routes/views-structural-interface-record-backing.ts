/*---
description: "Interface and Record views distinguish a data field from an own getter when writes change its backing field."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-closures, ts-interfaces, ts-index-signatures, ts-record, ts-accessors, ts-structural-typing, ts-optional-properties]
---*/
// Structural p is data or an accessor over raw; node exposes Record raw writes through interface reads and setter writes through Record raw readback.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface BackingView { [key: string]: ViewValue; raw: ViewValue; p: ViewValue; "2": ViewValue; maybe?: ViewValue }
function inspect(input: ViewValue, accessor: boolean, present: boolean): void {
  const log: unknown[] = [];
  const source: BackingView = accessor ? { raw: input, get p(): ViewValue { log.push("get", this.raw); return this.raw; }, set p(value: ViewValue) { log.push("set", this.raw, value); this.raw = value; }, "2": input } : { raw: input, p: input, "2": input };
  if (present) source.maybe = undefined;
  const view: { p: ViewValue } = source, table: Record<string, ViewValue> = source; same(view, source); same(table, source);
  const before = view.p; log.push("before", before); table.raw = replacement;
  const changed = view.p; log.push("changed", changed); view.p = marker;
  const backing = table.raw; log.push("backing", backing); table.p = input;
  const final = view.p; log.push("final", final);
  same(before, input); same(changed, accessor ? replacement : input); same(backing, accessor ? marker : replacement); same(final, input); same(source.raw, accessor ? input : replacement); same(source["2"], input);
  const keys = ["2", "raw", "p"]; if (present) keys.push("maybe"); order(view, keys); same(Object.hasOwn(table, "maybe"), present);
  let expected: unknown[] = ["before", input, "changed", input, "backing", replacement, "final", input];
  if (accessor) expected = ["get", input, "before", input, "get", replacement, "changed", replacement, "set", replacement, marker, "backing", marker, "set", marker, input, "get", input, "final", input];
  same(source.maybe, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) for (const accessor of [false, true]) for (const present of [false, true]) inspect(input, accessor, present);
