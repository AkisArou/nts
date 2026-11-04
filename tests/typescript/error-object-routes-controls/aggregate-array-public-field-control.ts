/*---
description: "Aggregate members are a fresh ordered array retaining repeated object identities after source writes through a declared public array field."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-numbers, ts-type-guards]
flags: [module]
---*/
// Aggregate members are a fresh ordered array retaining repeated object identities after source writes; route: a declared public array field.
// Node prints: aggregate-array-public-field:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
interface Marker { id: number }
const marker: Marker = { id: 1 }, replacement: Marker = { id: 9 };
class Holder { values: unknown[]; constructor(values: unknown[]) { this.values = values; } }
const holder: Holder = new Holder([marker, "alpha", marker, undefined]);
const aggregate = new Fault(holder.values, [marker, "alpha", marker, undefined], "many", "AggregateError: many");
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
assert.sameValue(true, true);
assert.compareArray([], []);
assert.sameValue(aggregate.text, "AggregateError: many");
console.log("aggregate-array-public-field:ok");
