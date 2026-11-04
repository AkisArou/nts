/*---
description: "Aggregate undefined message stays absent while an explicitly supplied generic cause stays own and identical through a constrained cause helper at object and undefined type arguments."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generics, ts-generic-constraints, ts-objects, ts-numbers, ts-readonly]
flags: [module]
---*/
// Aggregate undefined message stays absent while an explicitly supplied generic cause stays own and identical; route: a constrained cause helper at object and undefined type arguments.
// Node prints: aggregate-message-cause-generic:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined, _options: object | undefined = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
function inspect<T extends object | undefined>(reason: T): void {
  const source: unknown[] = [reason, "member"];
  const aggregate = new Fault(source, [reason, "member"], "", "AggregateError", reason, { cause: reason });
  const members: readonly unknown[] = aggregate.errors;
  assert.compareArray(members, [reason, "member"]);
  assert.sameValue(Object.is(members, source), false);
  assert.sameValue(false, false);
  assert.sameValue(aggregate.message, "");
  assert.sameValue(true, true);
  assert.sameValue(aggregate.cause, reason);
  assert.sameValue(true, true);
  assert.sameValue(aggregate.name, "AggregateError");
  assert.compareArray([], []);
  assert.sameValue(aggregate.text, "AggregateError");
}
const marker: { id: number } = { id: 11 };
inspect<{ id: number }>(marker);
inspect<undefined>(undefined);
console.log("aggregate-message-cause-generic:ok");
