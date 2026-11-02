/*---
description: A generic identity return preserves inferred arrow names and parameter cutoffs.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-generics, ts-generic-constraints, ts-arrow-functions, ts-default-parameters, ts-rest-parameters]
---*/
// A generic Numeric constraint returns arrows with zero, one and several parameters; node preserves names and excludes default and rest tails.
type Numeric = (a: number, b: number, c: number) => number;
function keep<T extends Numeric>(target: T): T { return target; }
const zeroArrow = (): number => 0;
const oneArrow = (a: number): number => a;
const threeArrow = (a: number, b: number, c: number): number => a + b + c;
const defaultArrow = (a: number, b = 8, c?: number): number => a + b + (c ?? 0);
const restArrow = (...values: number[]): number => 0;
function observe(value: Numeric): [string, number] { const target = keep(value); return [target.name, target.length]; }
const targets: Numeric[] = [zeroArrow, oneArrow, threeArrow, defaultArrow, restArrow];
const expected: [string, number][] = [["zeroArrow", 0], ["oneArrow", 1], ["threeArrow", 3], ["defaultArrow", 1], ["restArrow", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 5);
