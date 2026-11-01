/*---
description: Box retains references across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-objects, ts-arrays, ts-function-types, ts-closures, ts-arrow-functions, ts-symbols, ts-type-aliases]
---*/
// Box<T> uses RoutePoint, number[], RouteThunk, symbol together; node preserves each initial value, replacement and returned old value.
type RoutePoint = { id: number };
type RouteThunk = () => number;
class Box<T> {
  private current: T; constructor(value: T) { this.current = value; }
  read(): T { return this.current; }
  replace(next: T): T { const old = this.current; this.current = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, list = [n], nextList = [n, 9];
  const thunk: RouteThunk = () => n, nextThunk: RouteThunk = () => n + 1;
  const symbol = Symbol("same"), nextSymbol = Symbol("same");
  const v0 = new Box<RoutePoint>(point), v1 = new Box<number[]>(list);
  const v2 = new Box<RouteThunk>(thunk), v3 = new Box<symbol>(symbol);
  same(v0.read(), point); same(v0.replace(nextPoint), point); same(v0.read(), nextPoint);
  same(v1.read(), list); same(v1.replace(nextList), list); same(v1.read(), nextList);
  same(v2.read(), thunk); same(v2.replace(nextThunk), thunk); same(v2.read(), nextThunk);
  same(v3.read(), symbol); same(v3.replace(nextSymbol), symbol); same(v3.read(), nextSymbol);
}
