/*---
description: "findLast visits a typed array from the end with exact values, indices and receiver identity."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-typed-array-methods, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-typeof-operator, ts-template-literals, ts-closures, ts-objects]
---*/
// findLast crosses an interface-held Float32Array and a typed logged predicate; node stops at the last SameValue match, distinguishes both zeros and NaN, and leaves the view unchanged.
const log: string[] = [];
interface Carrier { view: Float32Array; }
function check(route: Carrier, sought: number, expected: number | undefined, expectedLog: string[]): void {
  const source = route.view, before = Array.from(source); log.length = 0;
  function predicate(value: number, index: number, array: Float32Array): boolean {
    log.push(`${index}:${Object.is(value, -0) ? "-0" : String(value)}:${array === source}`);
    return Object.is(value, sought);
  }
  const result = route.view.findLast(predicate);
  const again = route.view;
  assert.compareArray(log, expectedLog);
  assert.sameValue(result, expected); assert.sameValue(typeof result, expected === undefined ? "undefined" : "number");
  assert.sameValue(again, source); assert.compareArray(Array.from(again), before); assert.sameValue(again.length, before.length);
}
for (const first of [3, 7]) {
  const route: Carrier = { view: new Float32Array([first, -0, NaN, 2, first]) };
  const all = [`4:${first}:true`, "3:2:true", "2:NaN:true", "1:-0:true", `0:${first}:true`];
  const rows: [number, number | undefined, string[]][] = [[first, first, [`4:${first}:true`]], [-0, -0, all.slice(0, 4)], [NaN, NaN, all.slice(0, 3)], [0, undefined, all], [99, undefined, all]];
  for (const [sought, expected, expectedLog] of rows) {
    check(route, sought, expected, expectedLog);
    check({ view: new Float32Array(0) }, sought, undefined, []);
  }
}
