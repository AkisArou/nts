/*---
description: "One class instance keeps four simultaneous typed views live while writes change later enumeration reads."
features: [ts-object-routes, ts-object-route-views, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-interfaces, ts-class, ts-class-fields, ts-declare-field, ts-index-signatures, ts-record, ts-generics, ts-generic-constraints, ts-structural-typing, ts-optional-properties]
---*/
// Interface, class, Record and generic aliases share p and tail; node visits each key once and later reads the tail written during the p visit.
type ViewValue = number | string | boolean | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: ViewValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function order(value: object, keys: string[]): void { assert.compareArray(Object.keys(value), keys); const seen: string[] = []; for (const key in value) seen.push(key); assert.compareArray(seen, keys); }
interface SharedView { p: ViewValue; tail: ViewValue }
class SharedCell {
  [key: string]: ViewValue; p: ViewValue; tail: ViewValue; declare maybe?: ViewValue; declare "2"?: ViewValue; declare "10"?: ViewValue;
  constructor(input: ViewValue, mixed: boolean, present: boolean) { this.p = input; this.tail = marker; if (mixed) { this["10"] = marker; this["2"] = input; } if (present) this.maybe = undefined; }
}
function cross<T extends SharedCell>(generic: T, source: SharedCell, input: ViewValue, mixed: boolean, present: boolean, keys: string[]): void {
  const view: SharedView = generic, table: Record<string, ViewValue> = generic, log: unknown[] = [];
  same(view, source); same(table, source); same(generic, source); order(view, keys); order(table, keys);
  for (const key of Object.keys(generic)) {
    const value = table[key]; same(value, key === "10" ? marker : key === "maybe" ? undefined : input); log.push("visit", key, value);
    if (key === "p") {
      view.tail = input; log.push("interface", source.tail); same(table.tail, input);
      source.p = marker; log.push("class", generic.p); same(view.p, marker);
      table.p = replacement; log.push("record", view.p); same(source.p, replacement);
      generic.p = input; log.push("generic", source.p); same(table.p, input);
    }
  }
  const expected: unknown[] = []; if (mixed) expected.push("visit", "2", input, "visit", "10", marker);
  expected.push("visit", "p", input, "interface", input, "class", marker, "record", replacement, "generic", input, "visit", "tail", input);
  if (present) expected.push("visit", "maybe", undefined);
  same(source.maybe, undefined); assert.compareArray(log, expected); same(source.p, input); same(source.tail, input); same(Object.hasOwn(view, "maybe"), present); order(generic, keys);
}
for (const input of inputs) for (const mixed of [false, true]) for (const present of [false, true]) {
  const keys = mixed ? ["2", "10", "p", "tail"] : ["p", "tail"]; if (present) keys.push("maybe");
  const source = new SharedCell(input, mixed, present); cross(source, source, input, mixed, present, keys);
}
