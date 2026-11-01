/*---
description: Control for classes-stack-references; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-objects, ts-arrays, ts-function-types, ts-closures, ts-arrow-functions, ts-symbols, ts-type-aliases, ts-null-undefined]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RoutePoint = { id: number };
type RouteThunk = () => number;
class PointStack {
  private items: RoutePoint[] = []; constructor(value: RoutePoint) { this.items.push(value); }
  read(): RoutePoint | undefined { return this.items[this.items.length - 1]; }
  replace(next: RoutePoint): RoutePoint | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): RoutePoint | undefined { return this.items.pop(); }
}
class ArrayStack {
  private items: number[][] = []; constructor(value: number[]) { this.items.push(value); }
  read(): number[] | undefined { return this.items[this.items.length - 1]; }
  replace(next: number[]): number[] | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): number[] | undefined { return this.items.pop(); }
}
class ThunkStack {
  private items: RouteThunk[] = []; constructor(value: RouteThunk) { this.items.push(value); }
  read(): RouteThunk | undefined { return this.items[this.items.length - 1]; }
  replace(next: RouteThunk): RouteThunk | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): RouteThunk | undefined { return this.items.pop(); }
}
class SymbolStack {
  private items: symbol[] = []; constructor(value: symbol) { this.items.push(value); }
  read(): symbol | undefined { return this.items[this.items.length - 1]; }
  replace(next: symbol): symbol | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): symbol | undefined { return this.items.pop(); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, list = [n], nextList = [n, 9];
  const thunk: RouteThunk = () => n, nextThunk: RouteThunk = () => n + 1;
  const symbol = Symbol("same"), nextSymbol = Symbol("same");
  const v0 = new PointStack(point), v1 = new ArrayStack(list);
  const v2 = new ThunkStack(thunk), v3 = new SymbolStack(symbol);
  same(v0.read(), point); same(v0.replace(nextPoint), point); same(v0.read(), nextPoint);
  same(v0.pop(), nextPoint); same(v0.pop(), undefined);
  same(v1.read(), list); same(v1.replace(nextList), list); same(v1.read(), nextList);
  same(v1.pop(), nextList); same(v1.pop(), undefined);
  same(v2.read(), thunk); same(v2.replace(nextThunk), thunk); same(v2.read(), nextThunk);
  same(v2.pop(), nextThunk); same(v2.pop(), undefined);
  same(v3.read(), symbol); same(v3.replace(nextSymbol), symbol); same(v3.read(), nextSymbol);
  same(v3.pop(), nextSymbol); same(v3.pop(), undefined);
}
