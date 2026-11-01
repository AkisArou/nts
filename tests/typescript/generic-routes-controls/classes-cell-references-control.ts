/*---
description: Control for classes-cell-references; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-objects, ts-arrays, ts-function-types, ts-closures, ts-arrow-functions, ts-symbols, ts-type-aliases, ts-accessors]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RoutePoint = { id: number };
type RouteThunk = () => number;
class PointCell {
  private current: RoutePoint; constructor(value: RoutePoint) { this.current = value; }
  get value(): RoutePoint { return this.current; }
  set value(next: RoutePoint) { this.current = next; }
  replace(next: RoutePoint): RoutePoint { const old = this.value; this.value = next; return old; }
}
class ArrayCell {
  private current: number[]; constructor(value: number[]) { this.current = value; }
  get value(): number[] { return this.current; }
  set value(next: number[]) { this.current = next; }
  replace(next: number[]): number[] { const old = this.value; this.value = next; return old; }
}
class ThunkCell {
  private current: RouteThunk; constructor(value: RouteThunk) { this.current = value; }
  get value(): RouteThunk { return this.current; }
  set value(next: RouteThunk) { this.current = next; }
  replace(next: RouteThunk): RouteThunk { const old = this.value; this.value = next; return old; }
}
class SymbolCell {
  private current: symbol; constructor(value: symbol) { this.current = value; }
  get value(): symbol { return this.current; }
  set value(next: symbol) { this.current = next; }
  replace(next: symbol): symbol { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, list = [n], nextList = [n, 9];
  const thunk: RouteThunk = () => n, nextThunk: RouteThunk = () => n + 1;
  const symbol = Symbol("same"), nextSymbol = Symbol("same");
  const v0 = new PointCell(point), v1 = new ArrayCell(list);
  const v2 = new ThunkCell(thunk), v3 = new SymbolCell(symbol);
  same(v0.value, point); same(v0.replace(nextPoint), point); same(v0.value, nextPoint);
  same(v1.value, list); same(v1.replace(nextList), list); same(v1.value, nextList);
  same(v2.value, thunk); same(v2.replace(nextThunk), thunk); same(v2.value, nextThunk);
  same(v3.value, symbol); same(v3.replace(nextSymbol), symbol); same(v3.value, nextSymbol);
}
