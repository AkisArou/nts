/*---
description: "Control for views-class-shaped-accessor-ownership; A class-typed consumer preserves own versus inherited accessors on structurally compatible literals and instances."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-optional-properties, ts-closures]
---*/
// The same class parameter accepts a real instance, an own accessor literal and data; node keeps each key set while raw and p writes follow the original shape. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type AccessCell = { raw: ViewValue; "2": ViewValue; p?: ViewValue; maybe?: ViewValue };
function inspect(input: ViewValue, kind: "class" | "accessor" | "data", present: boolean): void {
  const log: unknown[] = [], source: AccessCell = { raw: input, "2": input }; let hasP = false, hasMaybe = false;
  if (kind !== "class") { source.p = input; hasP = true; } if (present) { source.maybe = undefined; hasMaybe = true; }
  function read(): ViewValue { if (kind !== "data") { log.push("get", source.raw); return source.raw; } return source.p; }
  function write(value: ViewValue): void { if (kind !== "data") { log.push("set", source.raw, value); source.raw = value; } else source.p = value; }
  function cross(value: AccessCell): ViewValue[] {
    same(value, source); const before = read(); log.push("before", before); source.raw = marker;
    const middle = read(); log.push("middle", middle); write(replacement);
    const backing = source.raw, final = read(); log.push("after", backing, final); return [before, middle, backing, final];
  }
  const actual = cross(source), accessor = kind !== "data";
  same(actual[0], input); same(actual[1], accessor ? marker : input); same(actual[2], accessor ? replacement : marker); same(actual[3], replacement);
  const keys = kind === "class" ? ["2", "raw"] : ["2", "raw", "p"]; if (present) keys.push("maybe"); order(source, keys);
  same(hasP, kind !== "class"); same(hasMaybe, present); same(source["2"], input);
  let expected: unknown[] = ["before", input, "middle", input, "after", marker, replacement];
  if (accessor) expected = ["get", input, "before", input, "get", marker, "middle", marker, "set", marker, replacement, "get", replacement, "after", replacement, replacement];
  same(source.maybe, undefined); assert.compareArray(log, expected);
}
const kinds: ("class" | "accessor" | "data")[] = ["class", "accessor", "data"];
for (const input of inputs) for (const kind of kinds) for (const present of [false, true]) inspect(input, kind, present);
