/*---
description: A generic compose infers each stage's type from the functions it is given.
features: [ts-generics, ts-function-types]
---*/
function compose<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C {
  return (a) => g(f(a));
}
const lengthThenDouble = compose((s: string) => s.length, (n) => n * 2);
const isLong = compose(lengthThenDouble, (n) => n > 6);
assert.sameValue(lengthThenDouble("abc"), 6);
assert.sameValue(isLong("abc"), false);
assert.sameValue(isLong("abcd"), true);
