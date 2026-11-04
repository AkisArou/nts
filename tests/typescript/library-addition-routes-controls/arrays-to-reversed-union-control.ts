/*---
description: "Control for arrays-to-reversed-union; toReversed through an instanceof-narrowed array-or-holder union preserves exact results and its receiver."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-type-aliases, ts-interfaces, ts-objects, ts-to-primitive, ts-class, ts-class-fields, ts-this, ts-instanceof, ts-narrowing]
---*/
// toReversed crosses an instanceof-narrowed array-or-holder union; node reverses empty, singleton, mixed and sparse arrays into fresh dense copies, preserves SameValue elements and object identity, and leaves source contents, length and own keys unchanged. The control uses older indexed loops in place of the new method.
const log: string[] = [];
interface Token { label: string; valueOf(): number; toString(): string; }
type Value = number | string | undefined | Token;
const token: Token = { label: "token", valueOf(): number { log.push("valueOf"); return 99; }, toString(): string { log.push("toString"); return "token"; } };
class Carrier { values: Value[]; constructor(values: Value[]) { this.values = values; } }
function check(route: Value[] | Carrier, expected: Value[]): void {
  const source = (route instanceof Carrier ? route.values : route);
  const before = source.slice(), keys = Object.keys(source); log.length = 0;
  log.push("copy");
  const values = (route instanceof Carrier ? route.values : route), length = values.length;
  const result: Value[] = [];
  for (let index = length - 1; index >= 0; index--) result.push(values[index]);
  const again = (route instanceof Carrier ? route.values : route);
  assert.compareArray(log, ["copy"]);
  assert.sameValue(again, source); assert.sameValue(result === source, false); assert.sameValue(Array.isArray(result), true);
  assert.compareArray(result, expected); assert.sameValue(result.length, expected.length);
  assert.compareArray(again, before); assert.sameValue(again.length, before.length); assert.compareArray(Object.keys(again), keys);
  for (let index = 0; index < result.length; index++) assert.sameValue(Object.hasOwn(result, index), true);
  result.push("copy-only"); assert.compareArray(again, before); assert.sameValue(again.length, before.length);
}
for (const seed of [2, 9]) {
  const rows: [Value[], Value[]][] = [[[], []], [[token], [token]], [[seed, -0, NaN, token], [token, NaN, -0, seed]], [[seed, , undefined, token], [token, undefined, undefined, seed]]];
  for (const [input, expected] of rows) { for (const boxed of [false, true]) check(boxed ? new Carrier(input) : input, expected); }
}
