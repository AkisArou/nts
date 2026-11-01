/*---
description: Control for classes-box-references; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-objects, ts-arrays, ts-function-types, ts-closures, ts-arrow-functions, ts-symbols, ts-type-aliases]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RoutePoint = { id: number };
type RouteThunk = () => number;
class PointBox {
  private current: RoutePoint; constructor(value: RoutePoint) { this.current = value; }
  read(): RoutePoint { return this.current; }
  replace(next: RoutePoint): RoutePoint { const old = this.current; this.current = next; return old; }
}
class ArrayBox {
  private current: number[]; constructor(value: number[]) { this.current = value; }
  read(): number[] { return this.current; }
  replace(next: number[]): number[] { const old = this.current; this.current = next; return old; }
}
class ThunkBox {
  private current: RouteThunk; constructor(value: RouteThunk) { this.current = value; }
  read(): RouteThunk { return this.current; }
  replace(next: RouteThunk): RouteThunk { const old = this.current; this.current = next; return old; }
}
class SymbolBox {
  private current: symbol; constructor(value: symbol) { this.current = value; }
  read(): symbol { return this.current; }
  replace(next: symbol): symbol { const old = this.current; this.current = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, list = [n], nextList = [n, 9];
  const thunk: RouteThunk = () => n, nextThunk: RouteThunk = () => n + 1;
  const symbol = Symbol("same"), nextSymbol = Symbol("same");
  const v0 = new PointBox(point), v1 = new ArrayBox(list);
  const v2 = new ThunkBox(thunk), v3 = new SymbolBox(symbol);
  same(v0.read(), point); same(v0.replace(nextPoint), point); same(v0.read(), nextPoint);
  same(v1.read(), list); same(v1.replace(nextList), list); same(v1.read(), nextList);
  same(v2.read(), thunk); same(v2.replace(nextThunk), thunk); same(v2.read(), nextThunk);
  same(v3.read(), symbol); same(v3.replace(nextSymbol), symbol); same(v3.read(), nextSymbol);
}
