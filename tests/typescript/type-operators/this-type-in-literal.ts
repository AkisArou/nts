/*---
description: ThisType<T> types `this` in an object literal's methods; the call supplies that object at run time.
features: [ts-type-operators, ts-this, ts-utility-types]
---*/
type Methods<S> = Record<string, (this: S, ...args: number[]) => number>;
function define<S, M extends Methods<S>>(state: S, methods: M & ThisType<S>): S & M {
  return Object.assign(Object.create(null) as object, state, methods) as S & M;
}
const counter = define(
  { count: 10 },
  {
    add(n: number): number {
      this.count += n;
      return this.count;
    },
  },
);
assert.sameValue(counter.add(5), 15);
assert.sameValue(counter.count, 15);
