/*---
description: A variadic tuple type binds a function's leading arguments and leaves a function of the rest.
features: [ts-tuples, ts-variadic-tuples, ts-generics, ts-rest-parameters]
---*/
function partial<Head extends unknown[], Tail extends unknown[], R>(
  f: (...args: [...Head, ...Tail]) => R,
  ...head: Head
): (...tail: Tail) => R {
  return (...tail) => f(...head, ...tail);
}
function volume(w: number, h: number, d: number): number {
  return w * h * d;
}
const withWidth = partial(volume, 2);
const withBoth = partial(volume, 2, 3);
assert.sameValue(withWidth(3, 4), 24);
assert.sameValue(withBoth(5), 30);
