/*---
description: "Aggregate copying keeps primitive and reference members after the generic source is replaced through a constrained helper at number and object type arguments."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate copying keeps primitive and reference members after the generic source is replaced; route: a constrained helper at number and object type arguments.
// Node prints: aggregate-array-generic:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
function inspect<T extends number | { id: number }>(value: T): void {
  const source: (T | string | undefined)[] = [value, "tag", value, undefined];
  const aggregate = new Fault(source, [value, "tag", value, undefined], "many", "AggregateError: many");
  const members: unknown[] = aggregate.errors;
  assert.sameValue(Object.is(members, source), false);
  source.splice(0, source.length, "changed");
  assert.compareArray(members, [value, "tag", value, undefined]);
  members.push("extra");
  assert.compareArray(source, ["changed"]);
  assert.sameValue(members[0], value);
  assert.sameValue(members[2], value);
  assert.sameValue(true, true);
  assert.compareArray([], []);
  assert.sameValue(aggregate.text, "AggregateError: many");
}
inspect<number>(-0);
const marker: { id: number } = { id: 4 };
inspect<{ id: number }>(marker);
console.log("aggregate-array-generic:ok");
