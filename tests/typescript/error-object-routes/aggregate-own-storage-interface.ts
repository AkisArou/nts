/*---
description: "Aggregate own message cause and errors remain hidden from keys JSON spread and for-in through an interface with nonempty and empty-message factory implementations."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-class, ts-interfaces, ts-readonly, ts-objects, ts-numbers, ts-spread]
flags: [module]
---*/
// Aggregate own message cause and errors remain hidden from keys JSON spread and for-in; route: an interface with nonempty and empty-message factory implementations.
// Node prints: aggregate-own-storage-interface:ok
const marker: { id: number } = { id: 12 };
interface Factory { make(): AggregateError }
class Named implements Factory { make(): AggregateError { return new AggregateError([marker, 1], "many", { cause: marker }); } }
class Empty implements Factory { make(): AggregateError { return new AggregateError([marker, 1], "", { cause: undefined }); } }
const factories: readonly Factory[] = [new Named(), new Empty()];
const text: readonly string[] = ["AggregateError: many", "AggregateError"];
const causes: readonly unknown[] = [marker, undefined];
for (let i = 0; i < factories.length; i++) {
  const aggregate = factories[i].make();
  const members: readonly unknown[] = aggregate.errors;
  assert.compareArray(members, [marker, 1]);
  assert.sameValue(Object.hasOwn(aggregate, "errors"), true);
  assert.sameValue(Object.hasOwn(aggregate, "message"), true);
  assert.sameValue(Object.hasOwn(aggregate, "cause"), true);
  assert.sameValue(Object.hasOwn(aggregate, "name"), false);
  assert.sameValue(aggregate.cause, causes[i]);
  assert.compareArray(Object.keys(aggregate), []);
  assert.sameValue(JSON.stringify(aggregate), "{}");
  const copy = { ...aggregate };
  assert.compareArray(Object.keys(copy), []);
  const visited: string[] = [];
  for (const key in aggregate) visited.push(key);
  assert.compareArray(visited, []);
  assert.sameValue(String(aggregate), text[i]);
}
console.log("aggregate-own-storage-interface:ok");
