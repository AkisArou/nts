/*---
description: "Aggregate copying keeps Map value order and reference members after updates and deletion through a declared static Map field."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-static, ts-map-set, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate copying keeps Map value order and reference members after updates and deletion; route: a declared static Map field.
// Node prints: aggregate-map-values-static-field:ok
const marker: { id: number } = { id: 8 }, replacement: { id: number } = { id: 9 };
class Registry {
  static values: Map<string, unknown> = new Map<string, unknown>([["first", marker], ["second", "old"], ["last", marker], ["tail", "tail"]]);
}
Registry.values.set("second", "map");
const aggregate = new AggregateError(Registry.values.values(), "many");
const members: readonly unknown[] = aggregate.errors;
Registry.values.delete("first");
Registry.values.set("second", "changed");
Registry.values.set("new", replacement);
assert.compareArray(Array.from(Registry.values.values()), ["changed", marker, "tail", replacement]);
assert.compareArray(members, [marker, "map", marker, "tail"]);
assert.sameValue(members[0], marker);
assert.sameValue(members[2], marker);
assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
assert.compareArray(Object.keys(aggregate), []);
assert.sameValue(String(aggregate), "AggregateError: many");
console.log("aggregate-map-values-static-field:ok");
