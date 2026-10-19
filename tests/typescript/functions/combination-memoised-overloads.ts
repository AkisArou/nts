/*---
description: An overloaded generic memoiser over closures and a Map, at a number key and a string key.
features: [ts-functions, ts-overloads, ts-generics, ts-closures, ts-map-set, ts-function-types]
---*/
function memo(f: (key: number) => number): (key: number) => number;
function memo(f: (key: string) => string): (key: string) => string;
function memo<K, V>(f: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, f(key));
    return cache.get(key) as V;
  };
}
let squares = 0;
const square = memo((n: number) => {
  squares++;
  return n * n;
});
const shout = memo((s: string) => s.toUpperCase());
assert.sameValue(square(9) + square(9), 162);
assert.sameValue(squares, 1);
assert.sameValue(shout("hi"), "HI");
