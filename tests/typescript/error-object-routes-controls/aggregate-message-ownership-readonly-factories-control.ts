/*---
description: "Aggregate omitted and undefined messages differ in ownership from explicit empty and nonempty messages through a readonly array of declared factory signatures."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-readonly, ts-arrow-functions, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate omitted and undefined messages differ in ownership from explicit empty and nonempty messages; route: a readonly array of declared factory signatures.
// Node prints: aggregate-message-ownership-readonly-factories:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
const marker: { id: number } = { id: 9 };
const source: unknown[] = [marker, "member"];
const factories: readonly (() => Fault)[] = [
  () => new Fault(source, [marker, "member"], "", "AggregateError"),
  () => new Fault(source, [marker, "member"], "", "AggregateError"),
  () => new Fault(source, [marker, "member"], "", "AggregateError"),
  () => new Fault(source, [marker, "member"], "many", "AggregateError: many")
];
const own: readonly boolean[] = [false, false, true, true];
const messages: readonly string[] = ["", "", "", "many"];
const text: readonly string[] = ["AggregateError", "AggregateError", "AggregateError", "AggregateError: many"];
for (let i = 0; i < factories.length; i++) {
  const aggregate = factories[i]();
  const members: readonly unknown[] = aggregate.errors;
  assert.compareArray(members, [marker, "member"]);
  assert.sameValue(Object.is(members, source), false);
  assert.sameValue([false, false, true, true][i], own[i]);
  assert.sameValue(aggregate.message, messages[i]);
  assert.sameValue(aggregate.name, "AggregateError");
  assert.sameValue(false, false);
  assert.sameValue(true, true);
  assert.compareArray([], []);
  assert.sameValue(aggregate.text, text[i]);
}
console.log("aggregate-message-ownership-readonly-factories:ok");
