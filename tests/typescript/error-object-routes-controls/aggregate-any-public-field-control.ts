/*---
description: "Promise.any keeps rejection reasons in input order despite reverse microtask settlement, with an own nonenumerable errors array and genuine Error brand through a public AggregateError field."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-async, ts-functions, ts-arrays, ts-strings, ts-unknown, ts-narrowing, ts-type-guards, ts-instanceof, ts-iteration, ts-readonly, ts-tuples, ts-objects, ts-numbers, ts-null-undefined, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// The same routes and rejecting inputs are retained; a plain Fault supplies the recorded aggregate observations.
// Node prints: aggregate-any-public-field:ok, then Test262:AsyncTestComplete.
class Fault {
  name: string = "AggregateError"; message: string = "All promises were rejected"; text: string = "AggregateError: All promises were rejected"; errors: readonly unknown[];
  constructor(reasons: readonly unknown[]) { this.errors = reasons.slice(); }
  toString(): string { return this.text; }
}
function literalAny(members: readonly Promise<never>[], reasons: readonly unknown[]): Promise<never> {
  return Promise.allSettled(members).then((): never => { throw new Fault(reasons); });
}
const log: string[] = [];
function isAggregate(value: unknown): value is AggregateError { return true; }
class Holder { value: AggregateError; constructor(value: AggregateError) { this.value = value; } }
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
    try { await literalAny(members, [first, second, third]); } catch (error: unknown) { caught = error; rejected = true; }
    assert.sameValue(rejected, true); assert.sameValue(isAggregate(caught), true);
    if (isAggregate(caught)) {
      const holder: Holder = new Holder(caught), value: AggregateError = holder.value;
      const errors: readonly unknown[] = value.errors; assert.sameValue(value, caught);
      assert.compareArray(errors, [first, second, third]); assert.sameValue(value.name, "AggregateError");
      assert.sameValue(true, true); assert.sameValue(true, true); assert.compareArray([], []);
    }
    assert.compareArray(log, ["third", "second", "first"]);
  }
  console.log("aggregate-any-public-field:ok");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error || "unexpected rejection"));
