/*---
description: "Control for views-generic-keyof-accessor-exchange; A generic keyed exchange returns the pre-write value and dispatches each accessor through later Record writes."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-optional-properties, ts-closures]
---*/
// Exchange<T,K> visits p or numeric key 2 on data and accessor shapes; node preserves old values, setter order and every shared readback. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type ExchangeCell = { p: ViewValue; "2": ViewValue; tail: ViewValue; maybe?: ViewValue };
function inspect(input: ViewValue, accessor: boolean, key: "p" | "2", present: boolean): void {
  const log: unknown[] = [], source: ExchangeCell = { p: input, "2": input, tail: marker }; let hasMaybe = false; if (present) { source.maybe = undefined; hasMaybe = true; }
  const table = source; same(table, source);
  function read(): ViewValue { let value = source.p; if (key === "2") value = source["2"]; if (accessor && key === "p") log.push("get", value); return value; }
  function write(value: ViewValue): void { if (accessor && key === "p") log.push("set", value); if (key === "p") source.p = value; else source["2"] = value; }
  const first = read(); write(replacement); log.push("first", first);
  const middle = read(); log.push("table", middle); write(marker);
  const last = read(); write(input); log.push("last", last);
  const final = read(); log.push("final", final); const finalP = source.p; if (accessor) log.push("get", finalP); same(finalP, input);
  same(first, input); same(middle, replacement); same(last, marker); same(final, input); same(source["2"], input); same(source.tail, marker);
  const keys = ["2", "p", "tail"]; if (present) keys.push("maybe"); order(source, keys); same(hasMaybe, present);
  let expected: unknown[] = ["first", input, "table", replacement, "last", marker, "final", input];
  if (accessor && key === "p") expected = ["get", input, "set", replacement, "first", input, "get", replacement, "table", replacement, "set", marker, "get", marker, "set", input, "last", marker, "get", input, "final", input];
  if (accessor) expected.push("get", input); same(source.maybe, undefined); assert.compareArray(log, expected);
}
const routeKeys: ("p" | "2")[] = ["p", "2"];
for (const input of inputs) for (const accessor of [false, true]) for (const key of routeKeys) for (const present of [false, true]) inspect(input, accessor, key, present);
