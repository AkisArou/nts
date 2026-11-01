/*---
description: Control for callbacks-method-specializations; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-class, ts-class-fields, ts-unions, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
class Chooser {
  calls: number = 0;
  chooseNumber(first: number, second: number, left: boolean): number { this.calls++; return left ? first : second; }
  chooseString(first: string, second: string, left: boolean): string { this.calls++; return left ? first : second; }
  choosePoint(first: RoutePoint, second: RoutePoint, left: boolean): RoutePoint { this.calls++; return left ? first : second; }
  chooseOptional(first: number | undefined, second: number | undefined, left: boolean): number | undefined { this.calls++; return left ? first : second; }
}
const chooser = new Chooser();
let calls = 0;
for (const n of [-0, NaN, 2.5]) {
  const word = String(n), point = { id: n }, next = { id: n + 1 };
  for (const left of [false, true]) {
    same(chooser.chooseNumber(n, n + 1, left), left ? n : n + 1);
    same(chooser.chooseString(word, word + "!", left), left ? word : word + "!");
    same(chooser.choosePoint(point, next, left), left ? point : next);
    same(chooser.chooseOptional(undefined, n, left), left ? undefined : n);
    calls += 4; same(chooser.calls, calls);
  }
}
