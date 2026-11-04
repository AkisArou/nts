/*---
description: "Aggregate copying keeps primitive and reference members after the generic source is replaced through a constrained helper at number and object type arguments."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate copying keeps primitive and reference members after the generic source is replaced; route: a constrained helper at number and object type arguments.
// Node prints: aggregate-array-generic:ok
function inspect<T extends number | { id: number }>(value: T): void {
  const source: (T | string | undefined)[] = [value, "tag", value, undefined];
  const aggregate = new AggregateError(source, "many");
  const members: unknown[] = aggregate.errors;
  assert.sameValue(Object.is(members, source), false);
  source.splice(0, source.length, "changed");
  assert.compareArray(members, [value, "tag", value, undefined]);
  members.push("extra");
  assert.compareArray(source, ["changed"]);
  assert.sameValue(members[0], value);
  assert.sameValue(members[2], value);
  assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
  assert.compareArray(Object.keys(aggregate), []);
  assert.sameValue(String(aggregate), "AggregateError: many");
}
inspect<number>(-0);
const marker: { id: number } = { id: 4 };
inspect<{ id: number }>(marker);
console.log("aggregate-array-generic:ok");
