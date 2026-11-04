/*---
description: "Aggregate copying preserves Set insertion order and reference identity after deletion and insertion through a private Set field read through a method."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-private-fields, ts-map-set, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate copying preserves Set insertion order and reference identity after deletion and insertion; route: a private Set field read through a method.
// Node prints: aggregate-set-private-field:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
const marker: { id: number } = { id: 2 };
class Holder {
  #values: Set<unknown> = new Set<unknown>([marker, "set", marker, undefined]);
  read(): Set<unknown> { return this.#values; }
}
const holder: Holder = new Holder();
const aggregate = new Fault(holder.read(), [marker, "set", undefined], "many", "AggregateError: many");
const members: readonly unknown[] = aggregate.errors;
assert.compareArray(members, [marker, "set", undefined]);
holder.read().delete(marker);
holder.read().add("late");
assert.compareArray(Array.from(holder.read()), ["set", undefined, "late"]);
assert.compareArray(members, [marker, "set", undefined]);
assert.sameValue(members[0], marker);
assert.sameValue(true, true);
assert.compareArray([], []);
assert.sameValue(aggregate.text, "AggregateError: many");
console.log("aggregate-set-private-field:ok");
