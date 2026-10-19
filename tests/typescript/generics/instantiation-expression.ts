/*---
description: An instantiation expression is erased; it is the same function object as the generic it instantiates.
features: [ts-generics, ts-instantiation-expression]
---*/
function identity<T>(value: T): T {
  return value;
}
const identityOfNumber = identity<number>;
const makeStringSet = Set<string>;
assert.sameValue(identityOfNumber, identity);
assert.sameValue(identityOfNumber(4), 4);
const set = new makeStringSet(["a", "a", "b"]);
assert.sameValue(set.size, 2);
assert.sameValue(makeStringSet, Set);
