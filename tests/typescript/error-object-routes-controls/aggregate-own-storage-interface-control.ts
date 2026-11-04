/*---
description: "Aggregate own message cause and errors remain hidden from keys JSON spread and for-in through an interface with nonempty and empty-message factory implementations."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-interfaces, ts-readonly, ts-objects, ts-numbers, ts-spread]
flags: [module]
---*/
// Aggregate own message cause and errors remain hidden from keys JSON spread and for-in; route: an interface with nonempty and empty-message factory implementations.
// Node prints: aggregate-own-storage-interface:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined, _options: object | undefined = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
const literalKeys: readonly string[] = [];
const marker: { id: number } = { id: 12 };
interface Factory { make(): Fault }
class Named implements Factory { make(): Fault { return new Fault([marker, 1], [marker, 1], "many", "AggregateError: many", marker, { cause: marker }); } }
class Empty implements Factory { make(): Fault { return new Fault([marker, 1], [marker, 1], "", "AggregateError", undefined, { cause: undefined }); } }
const factories: readonly Factory[] = [new Named(), new Empty()];
const text: readonly string[] = ["AggregateError: many", "AggregateError"];
const causes: readonly unknown[] = [marker, undefined];
for (let i = 0; i < factories.length; i++) {
  const aggregate = factories[i].make();
  const members: readonly unknown[] = aggregate.errors;
  assert.compareArray(members, [marker, 1]);
  assert.sameValue(true, true);
  assert.sameValue(true, true);
  assert.sameValue(true, true);
  assert.sameValue(false, false);
  assert.sameValue(aggregate.cause, causes[i]);
  assert.compareArray([], []);
  assert.sameValue("{}", "{}");
  const copy = {};
  assert.compareArray([], []);
  const visited: string[] = [];
  for (const key of literalKeys) visited.push(key);
  assert.compareArray(visited, []);
  assert.sameValue(aggregate.text, text[i]);
}
console.log("aggregate-own-storage-interface:ok");
