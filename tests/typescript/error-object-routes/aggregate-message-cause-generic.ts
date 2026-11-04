/*---
description: "Aggregate undefined message stays absent while an explicitly supplied generic cause stays own and identical through a constrained cause helper at object and undefined type arguments."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate undefined message stays absent while an explicitly supplied generic cause stays own and identical; route: a constrained cause helper at object and undefined type arguments.
// Node prints: aggregate-message-cause-generic:ok
function inspect<T extends object | undefined>(reason: T): void {
  const source: unknown[] = [reason, "member"];
  const aggregate = new AggregateError(source, undefined, { cause: reason });
  const members: readonly unknown[] = aggregate.errors;
  assert.compareArray(members, [reason, "member"]);
  assert.sameValue(Object.is(members, source), false);
  assert.sameValue(Object.hasOwn(aggregate, "message"), false);
  assert.sameValue(aggregate.message, "");
  assert.sameValue(Object.hasOwn(aggregate, "cause"), true);
  assert.sameValue(aggregate.cause, reason);
  assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
  assert.sameValue(aggregate.name, "AggregateError");
  assert.compareArray(Object.keys(aggregate), []);
  assert.sameValue(String(aggregate), "AggregateError");
}
const marker: { id: number } = { id: 11 };
inspect<{ id: number }>(marker);
inspect<undefined>(undefined);
console.log("aggregate-message-cause-generic:ok");
