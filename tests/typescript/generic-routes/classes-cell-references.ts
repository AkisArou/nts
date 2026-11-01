/*---
description: Cell retains references across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-objects, ts-arrays, ts-function-types, ts-closures, ts-arrow-functions, ts-symbols, ts-type-aliases, ts-accessors]
---*/
// Cell<T> uses RoutePoint, number[], RouteThunk, symbol together; node preserves each initial value, replacement and returned old value. The exchange goes through its getter and setter.
type RoutePoint = { id: number };
type RouteThunk = () => number;
class Cell<T> {
  private current: T; constructor(value: T) { this.current = value; }
  get value(): T { return this.current; }
  set value(next: T) { this.current = next; }
  replace(next: T): T { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, list = [n], nextList = [n, 9];
  const thunk: RouteThunk = () => n, nextThunk: RouteThunk = () => n + 1;
  const symbol = Symbol("same"), nextSymbol = Symbol("same");
  const v0 = new Cell<RoutePoint>(point), v1 = new Cell<number[]>(list);
  const v2 = new Cell<RouteThunk>(thunk), v3 = new Cell<symbol>(symbol);
  same(v0.value, point); same(v0.replace(nextPoint), point); same(v0.value, nextPoint);
  same(v1.value, list); same(v1.replace(nextList), list); same(v1.value, nextList);
  same(v2.value, thunk); same(v2.replace(nextThunk), thunk); same(v2.value, nextThunk);
  same(v3.value, symbol); same(v3.replace(nextSymbol), symbol); same(v3.value, nextSymbol);
}
