/*---
description: Stack retains references across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-objects, ts-arrays, ts-function-types, ts-closures, ts-arrow-functions, ts-symbols, ts-type-aliases, ts-null-undefined]
---*/
// Stack<T> uses RoutePoint, number[], RouteThunk, symbol together; node preserves each initial value, replacement and returned old value. Draining returns the replacement, then undefined.
type RoutePoint = { id: number };
type RouteThunk = () => number;
class Stack<T> {
  private items: T[] = []; constructor(value: T) { this.items.push(value); }
  read(): T | undefined { return this.items[this.items.length - 1]; }
  replace(next: T): T | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): T | undefined { return this.items.pop(); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, list = [n], nextList = [n, 9];
  const thunk: RouteThunk = () => n, nextThunk: RouteThunk = () => n + 1;
  const symbol = Symbol("same"), nextSymbol = Symbol("same");
  const v0 = new Stack<RoutePoint>(point), v1 = new Stack<number[]>(list);
  const v2 = new Stack<RouteThunk>(thunk), v3 = new Stack<symbol>(symbol);
  same(v0.read(), point); same(v0.replace(nextPoint), point); same(v0.read(), nextPoint);
  same(v0.pop(), nextPoint); same(v0.pop(), undefined);
  same(v1.read(), list); same(v1.replace(nextList), list); same(v1.read(), nextList);
  same(v1.pop(), nextList); same(v1.pop(), undefined);
  same(v2.read(), thunk); same(v2.replace(nextThunk), thunk); same(v2.read(), nextThunk);
  same(v2.pop(), nextThunk); same(v2.pop(), undefined);
  same(v3.read(), symbol); same(v3.replace(nextSymbol), symbol); same(v3.read(), nextSymbol);
  same(v3.pop(), nextSymbol); same(v3.pop(), undefined);
}
