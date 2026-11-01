/*---
description: "Control for views-four-way-enumeration-writes; One class instance keeps four simultaneous typed views live while writes change later enumeration reads."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-optional-properties]
---*/
// Interface, class, Record and generic aliases share p and tail; node visits each key once and later reads the tail written during the p visit. The control uses direct fields, explicit state operations and known key lists.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
type SharedCell = { p: ViewValue; tail: ViewValue; maybe?: ViewValue; "2"?: ViewValue; "10"?: ViewValue };
function cross(source: SharedCell, input: ViewValue, mixed: boolean, present: boolean, hasMaybe: boolean, keys: string[]): void {
  const view = source, table = source, generic = source, log: unknown[] = [];
  same(view, source); same(table, source); same(generic, source); order(view, keys); order(table, keys);
  for (const key of keys) {
    let value: ViewValue = source.p; if (key === "2") value = source["2"]; if (key === "10") value = source["10"]; if (key === "tail") value = source.tail; if (key === "maybe") value = source.maybe;
    same(value, key === "10" ? marker : key === "maybe" ? undefined : input); log.push("visit", key, value);
    if (key === "p") {
      source.tail = input; log.push("interface", source.tail); same(source.tail, input);
      source.p = marker; log.push("class", source.p); same(source.p, marker);
      source.p = replacement; log.push("record", source.p); same(source.p, replacement);
      source.p = input; log.push("generic", source.p); same(source.p, input);
    }
  }
  const expected: unknown[] = []; if (mixed) expected.push("visit", "2", input, "visit", "10", marker);
  expected.push("visit", "p", input, "interface", input, "class", marker, "record", replacement, "generic", input, "visit", "tail", input);
  if (present) expected.push("visit", "maybe", undefined);
  same(source.maybe, undefined); assert.compareArray(log, expected); same(source.p, input); same(source.tail, input); same(hasMaybe, present); order(source, keys);
}
for (const input of inputs) for (const mixed of [false, true]) for (const present of [false, true]) {
  const keys = mixed ? ["2", "10", "p", "tail"] : ["p", "tail"]; if (present) keys.push("maybe");
  const source: SharedCell = { p: input, tail: marker }; let hasMaybe = false; if (mixed) { source["10"] = marker; source["2"] = input; } if (present) { source.maybe = undefined; hasMaybe = true; }
  cross(source, input, mixed, present, hasMaybe, keys);
}
