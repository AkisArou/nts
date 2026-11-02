/*---
description: Explicit function-record control for A generic bound rest callback keeps all prepended and later operands while its remaining length stays zero.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-generics, ts-rest-parameters, ts-this-parameter, ts-this, ts-interfaces]
---*/
// A generic factory carries typed head/rest functions; binding beyond the head clamps length to zero without losing either argument group.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Result<T> { self: Receiver; items: T[]; }
interface Callable<T> { body: (self: Receiver, items: T[]) => Result<T>; label: string; arity: number; }
function collect<T>(self: Receiver, items: T[]): Result<T> { return { self, items }; }
const expression = function preserve<T>(self: Receiver, items: T[]): Result<T> { return { self, items }; };
function prepare<T>(fn: Callable<T>, receiver: Receiver, head: T, prefix: T[]): { run: (items: T[]) => Result<T>; label: string; arity: number } {
  const saved = [head].concat(prefix); let count = 0; for (const value of saved) count++;
  return { run: (items: T[]) => fn.body(receiver, saved.concat(items)), label: "bound " + fn.label, arity: Math.max(fn.arity - count, 0) };
}
const choices: { fn: Callable<Value>; expected: string }[] = [{ fn: { body: collect, label: "collect", arity: 1 }, expected: "collect" }, { fn: { body: expression, label: "preserve", arity: 1 }, expected: "preserve" }];
const identity = { token: "head" }, prefixes: Value[][] = [[], [-0], [undefined, NaN, null]], tails: Value[][] = [[], ["last"], [7, identity]];
for (const target of choices) for (const prefix of prefixes) for (const tail of tails) {
  const receiver: Receiver = { tag: "rest" }, bound = prepare(target.fn, receiver, identity, prefix), result = bound.run(tail);
  assert.sameValue(bound.label, "bound " + target.expected); assert.sameValue(bound.arity, 0);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, [identity, ...prefix, ...tail]);
  assert.sameValue(result.items === prefix, false); assert.sameValue(result.items === tail, false);
}
