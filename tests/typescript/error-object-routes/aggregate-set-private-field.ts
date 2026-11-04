/*---
description: "Aggregate copying preserves Set insertion order and reference identity after deletion and insertion through a private Set field read through a method."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-private-fields, ts-map-set, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate copying preserves Set insertion order and reference identity after deletion and insertion; route: a private Set field read through a method.
// Node prints: aggregate-set-private-field:ok
const marker: { id: number } = { id: 2 };
class Holder {
  #values: Set<unknown> = new Set<unknown>([marker, "set", marker, undefined]);
  read(): Set<unknown> { return this.#values; }
}
const holder: Holder = new Holder();
const aggregate = new AggregateError(holder.read(), "many");
const members: readonly unknown[] = aggregate.errors;
assert.compareArray(members, [marker, "set", undefined]);
holder.read().delete(marker);
holder.read().add("late");
assert.compareArray(Array.from(holder.read()), ["set", undefined, "late"]);
assert.compareArray(members, [marker, "set", undefined]);
assert.sameValue(members[0], marker);
assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
assert.compareArray(Object.keys(aggregate), []);
assert.sameValue(String(aggregate), "AggregateError: many");
console.log("aggregate-set-private-field:ok");
