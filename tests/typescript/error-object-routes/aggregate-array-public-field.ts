/*---
description: "Aggregate members are a fresh ordered array retaining repeated object identities after source writes through a declared public array field."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-numbers, ts-type-guards]
flags: [module]
---*/
// Aggregate members are a fresh ordered array retaining repeated object identities after source writes; route: a declared public array field.
// Node prints: aggregate-array-public-field:ok
interface Marker { id: number }
const marker: Marker = { id: 1 }, replacement: Marker = { id: 9 };
class Holder { values: unknown[]; constructor(values: unknown[]) { this.values = values; } }
const holder: Holder = new Holder([marker, "alpha", marker, undefined]);
const aggregate = new AggregateError(holder.values, "many");
const members: unknown[] = aggregate.errors;
assert.sameValue(Object.is(members, holder.values), false);
assert.compareArray(members, [marker, "alpha", marker, undefined]);
holder.values[0] = replacement;
holder.values.push("later");
assert.compareArray(members, [marker, "alpha", marker, undefined]);
members[1] = "inside";
assert.compareArray(holder.values, [replacement, "alpha", marker, undefined, "later"]);
marker.id = 3;
function id(value: unknown): number {
  if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "number") return value.id;
  return -1;
}
assert.sameValue(id(members[0]), 3);
assert.sameValue(members[0], members[2]);
assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
assert.compareArray(Object.keys(aggregate), []);
assert.sameValue(String(aggregate), "AggregateError: many");
console.log("aggregate-array-public-field:ok");
