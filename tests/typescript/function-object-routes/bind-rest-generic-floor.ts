/*---
description: A generic bound rest callback keeps all prepended and later operands while its remaining length stays zero.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-generics, ts-rest-parameters, ts-this-parameter, ts-this, ts-interfaces]
---*/
// A generic factory carries typed head/rest functions; binding beyond the head clamps length to zero without losing either argument group.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Result<T> { self: Receiver; items: T[]; }
function collect<T>(this: Receiver, head: T, ...tail: T[]): Result<T> { return { self: this, items: [head, ...tail] }; }
const expression = function preserve<T>(this: Receiver, head: T, ...tail: T[]): Result<T> { return { self: this, items: [head, ...tail] }; };
function prepare<T>(fn: (this: Receiver, head: T, ...tail: T[]) => Result<T>, receiver: Receiver, head: T, prefix: T[]): { run: (items: T[]) => Result<T>; label: string; arity: number } {
  const bound = fn.bind(receiver, head, ...prefix); return { run: (items: T[]) => bound(...items), label: bound.name, arity: bound.length };
}
const choices: { fn: (this: Receiver, head: Value, ...tail: Value[]) => Result<Value>; expected: string }[] = [{ fn: collect, expected: "collect" }, { fn: expression, expected: "preserve" }];
const identity = { token: "head" }, prefixes: Value[][] = [[], [-0], [undefined, NaN, null]], tails: Value[][] = [[], ["last"], [7, identity]];
for (const target of choices) for (const prefix of prefixes) for (const tail of tails) {
  const receiver: Receiver = { tag: "rest" }, bound = prepare(target.fn, receiver, identity, prefix), result = bound.run(tail);
  assert.sameValue(bound.label, "bound " + target.expected); assert.sameValue(bound.arity, 0);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, [identity, ...prefix, ...tail]);
  assert.sameValue(result.items === prefix, false); assert.sameValue(result.items === tail, false);
}
