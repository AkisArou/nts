/*---
description: "A class-typed consumer preserves own versus inherited accessors on structurally compatible literals and instances."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-literal-types, ts-class, ts-class-fields, ts-declare-field, ts-accessors, ts-structural-typing, ts-optional-properties, ts-closures]
---*/
// The same class parameter accepts a real instance, an own accessor literal and data; node keeps each key set while raw and p writes follow the original shape.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
function inspect(input: ViewValue, kind: "class" | "accessor" | "data", present: boolean): void {
  const log: unknown[] = [];
  class AccessCell {
    raw: ViewValue; "2": ViewValue; declare maybe?: ViewValue;
    constructor() { this.raw = input; this["2"] = input; }
    get p(): ViewValue { log.push("get", this.raw); return this.raw; }
    set p(value: ViewValue) { log.push("set", this.raw, value); this.raw = value; }
  }
  let source: AccessCell = new AccessCell();
  if (kind === "accessor") source = { raw: input, "2": input, get p(): ViewValue { log.push("get", this.raw); return this.raw; }, set p(value: ViewValue) { log.push("set", this.raw, value); this.raw = value; } };
  if (kind === "data") source = { raw: input, "2": input, p: input };
  if (present) source.maybe = undefined;
  function cross(value: AccessCell): ViewValue[] {
    same(value, source); const before = value.p; log.push("before", before); value.raw = marker;
    const middle = value.p; log.push("middle", middle); value.p = replacement;
    const backing = value.raw, final = value.p; log.push("after", backing, final); return [before, middle, backing, final];
  }
  const actual = cross(source), accessor = kind !== "data";
  same(actual[0], input); same(actual[1], accessor ? marker : input); same(actual[2], accessor ? replacement : marker); same(actual[3], replacement);
  const keys = kind === "class" ? ["2", "raw"] : ["2", "raw", "p"]; if (present) keys.push("maybe"); order(source, keys);
  same(Object.hasOwn(source, "p"), kind !== "class"); same(Object.hasOwn(source, "maybe"), present); same(source["2"], input);
  let expected: unknown[] = ["before", input, "middle", input, "after", marker, replacement];
  if (accessor) expected = ["get", input, "before", input, "get", marker, "middle", marker, "set", marker, replacement, "get", replacement, "after", replacement, replacement];
  same(source.maybe, undefined); assert.compareArray(log, expected);
}
const kinds: ("class" | "accessor" | "data")[] = ["class", "accessor", "data"];
for (const input of inputs) for (const kind of kinds) for (const present of [false, true]) inspect(input, kind, present);
