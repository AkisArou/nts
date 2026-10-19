/*---
description: A generic function returns a closure that keeps a value of its type parameter.
features: [ts-generics, ts-closures]
---*/
function once<T>(compute: () => T): () => T {
  let done = false;
  let value: T | undefined;
  return () => {
    if (!done) {
      value = compute();
      done = true;
    }
    return value as T;
  };
}
let runs = 0;
const lazyList = once(() => {
  runs++;
  return [runs, runs * 2];
});
assert.sameValue(lazyList(), lazyList());
assert.sameValue(runs, 1);
const lazyText = once(() => "text");
assert.sameValue(lazyText().length, 4);
