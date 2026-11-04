/*---
description: "Aggregate members preserve generic Map values independently of later source and copy writes through a constrained Map helper at primitive and object type arguments."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generics, ts-generic-constraints, ts-map-set, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate members preserve generic Map values independently of later source and copy writes; route: a constrained Map helper at primitive and object type arguments.
// Node prints: aggregate-map-values-generic:ok
function inspect<T extends number | { code: string }>(first: T, other: T): void {
  const registry: Map<string, T> = new Map<string, T>([["left", first], ["right", other], ["repeat", first], ["last", other]]);
  const aggregate = new AggregateError(registry.values(), "many");
  const members: unknown[] = aggregate.errors;
  registry.delete("left");
  registry.set("right", first);
  registry.set("later", other);
  assert.compareArray(members, [first, other, first, other]);
  assert.compareArray(Array.from(registry.values()), [first, first, other, other]);
  members[1] = "inside";
  assert.sameValue(registry.get("right"), first);
  assert.sameValue(members[0], first);
  assert.sameValue(members[2], first);
  assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
  assert.compareArray(Object.keys(aggregate), []);
  assert.sameValue(String(aggregate), "AggregateError: many");
}
inspect<number>(-0, NaN);
const left: { code: string } = { code: "left" }, right: { code: string } = { code: "right" };
inspect<{ code: string }>(left, right);
console.log("aggregate-map-values-generic:ok");
