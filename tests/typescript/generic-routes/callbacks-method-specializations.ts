/*---
description: Four generic method instantiations share one non-generic receiver while returning their selected values exactly.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-class, ts-class-fields, ts-unions, ts-unknown, ts-generics]
---*/
// Chooser.choose uses number, string, object and optional types on one receiver; node keeps both selection branches and one shared call counter.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
class Chooser {
  calls: number = 0;
  choose<T>(first: T, second: T, left: boolean): T { this.calls++; return left ? first : second; }
}
const chooser = new Chooser();
let calls = 0;
for (const n of [-0, NaN, 2.5]) {
  const word = String(n), point = { id: n }, next = { id: n + 1 };
  for (const left of [false, true]) {
    same(chooser.choose<number>(n, n + 1, left), left ? n : n + 1);
    same(chooser.choose<string>(word, word + "!", left), left ? word : word + "!");
    same(chooser.choose<RoutePoint>(point, next, left), left ? point : next);
    same(chooser.choose<number | undefined>(undefined, n, left), left ? undefined : n);
    calls += 4; same(chooser.calls, calls);
  }
}
