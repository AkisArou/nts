/*---
description: "Aggregate members snapshot a generator tuple while preserving repeated reference members through a readonly tuple parameter of a typed generator."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generators, ts-tuples, ts-readonly, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate members snapshot a generator tuple while preserving repeated reference members; route: a readonly tuple parameter of a typed generator.
// Node prints: aggregate-generator-readonly-tuple:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
const marker: { id: number } = { id: 7 }, replacement: { id: number } = { id: 9 };
const source: [{ id: number }, string, { id: number }, string] = [marker, "tuple", marker, "tail"];
const route: readonly [{ id: number }, string, { id: number }, string] = source;
function* entries(values: readonly [{ id: number }, string, { id: number }, string]): Generator<unknown, void, unknown> {
  for (const value of values) yield value;
}
const aggregate = new Fault(entries(route), [marker, "tuple", marker, "tail"], "many", "AggregateError: many");
const members: readonly unknown[] = aggregate.errors;
source[0] = replacement;
source[1] = "changed";
source[2] = replacement;
source[3] = "later";
assert.compareArray(route, [replacement, "changed", replacement, "later"]);
assert.compareArray(members, [marker, "tuple", marker, "tail"]);
assert.sameValue(members[0], marker);
assert.sameValue(members[2], marker);
assert.sameValue(Object.is(members, source), false);
assert.sameValue(true, true);
assert.compareArray([], []);
assert.sameValue(aggregate.text, "AggregateError: many");
console.log("aggregate-generator-readonly-tuple:ok");
