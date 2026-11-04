/*---
description: "Promise.any keeps rejection reasons in input order despite reverse microtask settlement, with an own nonenumerable errors array and genuine Error brand through a repeatedly assigned static AggregateError field."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-async, ts-functions, ts-arrays, ts-strings, ts-unknown, ts-narrowing, ts-type-guards, ts-instanceof, ts-iteration, ts-readonly, ts-tuples, ts-objects, ts-numbers, ts-null-undefined, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// Reverse settlement keeps input-order reasons, ownership and branding; route: a repeatedly assigned static AggregateError field.
// Node prints: aggregate-any-static-field:ok, then Test262:AsyncTestComplete.
const log: string[] = [];
function isAggregate(value: unknown): value is AggregateError { return value instanceof AggregateError; }
class Holder { static value: AggregateError; }
async function main(): Promise<void> {
  const marker = { id: 7 };
  const rows: readonly (readonly [unknown, unknown, unknown])[] = [[marker, "middle", undefined], [-0, null, false]];
  for (const [first, second, third] of rows) {
    log.length = 0;
    const members: Promise<never>[] = [
      new Promise<never>((_resolve, reject) => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => { log.push("first"); reject(first); })))),
      new Promise<never>((_resolve, reject) => queueMicrotask(() => queueMicrotask(() => { log.push("second"); reject(second); }))),
      new Promise<never>((_resolve, reject) => queueMicrotask(() => { log.push("third"); reject(third); }))
    ];
    let caught: unknown, rejected: boolean = false;
    try { await Promise.any(members); } catch (error: unknown) { caught = error; rejected = true; }
    assert.sameValue(rejected, true); assert.sameValue(isAggregate(caught), true);
    if (isAggregate(caught)) {
      Holder.value = caught; const value: AggregateError = Holder.value;
      const errors: readonly unknown[] = value.errors; assert.sameValue(value, caught);
      assert.compareArray(errors, [first, second, third]); assert.sameValue(value.name, "AggregateError");
      assert.sameValue(Error.isError(value), true); assert.sameValue(Object.hasOwn(value, "errors"), true); assert.compareArray(Object.keys(value), []);
    }
    assert.compareArray(log, ["third", "second", "first"]);
  }
  console.log("aggregate-any-static-field:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error || "unexpected rejection"));
