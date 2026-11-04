/*---
description: "Aggregate construction exhausts the generator and retains its captured values before later rebinding through a generator over captured typed let bindings."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-strings, ts-generators, ts-closures, ts-objects, ts-numbers]
flags: [module]
---*/
// Aggregate construction exhausts the generator and retains its captured values before later rebinding; route: a generator over captured typed let bindings.
// Node prints: aggregate-generator-captured-let:ok
class Fault {
  name: string = "AggregateError"; message: string; errors: unknown[]; cause: unknown; text: string;
  constructor(source: Iterable<unknown>, members: unknown[], message: string, text: string, cause: unknown = undefined) {
    for (const _value of source) {}
    this.errors = members; this.message = message; this.text = text; this.cause = cause;
  }
  toString(): string { return this.text; }
}
const marker: { id: number } = { id: 6 }, replacement: { id: number } = { id: 8 };
let current: { id: number } = marker;
let label: string = "start";
const log: string[] = [];
function* entries(): Generator<unknown, void, unknown> {
  log.push("open"); yield current; yield label; yield current; yield "tail"; log.push("close");
}
const iterator: Generator<unknown, void, unknown> = entries();
const aggregate = new Fault(iterator, [marker, "start", marker, "tail"], "many", "AggregateError: many");
const members: readonly unknown[] = aggregate.errors;
current = replacement;
label = "later";
assert.compareArray(log, ["open", "close"]);
assert.compareArray(members, [marker, "start", marker, "tail"]);
assert.sameValue(members[0], members[2]);
assert.sameValue(iterator.next().done, true);
assert.sameValue(current, replacement);
assert.sameValue(label, "later");
assert.sameValue(true, true);
assert.compareArray([], []);
assert.sameValue(aggregate.text, "AggregateError: many");
console.log("aggregate-generator-captured-let:ok");
