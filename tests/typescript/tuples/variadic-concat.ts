/*---
description: A variadic tuple type concatenates two tuples, keeping each element's type.
features: [ts-tuples, ts-variadic-tuples, ts-generics]
---*/
function concat<A extends unknown[], B extends unknown[]>(a: [...A], b: [...B]): [...A, ...B] {
  return [...a, ...b];
}
const joined = concat([1, "two"], [true, 4]);
assert.sameValue(joined.length, 4);
assert.sameValue(joined[1].toUpperCase(), "TWO");
assert.sameValue(joined[2], true);
assert.sameValue(joined[3] * 2, 8);
