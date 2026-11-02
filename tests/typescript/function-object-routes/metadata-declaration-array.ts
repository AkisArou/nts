/*---
description: Declared functions retain names and parameter cutoffs through an array of one function type.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-default-parameters, ts-rest-parameters, ts-optional-parameters]
---*/
// A Numeric array carries seven declarations; node preserves each declaration name and stops arity at the first default or rest.
type Numeric = (a: number, b: number, c: number) => number;
function metaZero(): number { return 0; }
function metaOne(a: number): number { return a; }
function metaThree(a: number, b: number, c: number): number { return a + b + c; }
function metaOptional(a?: number, b?: number, c?: number): number { return (a ?? 0) + (b ?? 0) + (c ?? 0); }
function metaDefault(a: number, b = 7, c?: number): number { return a + b + (c ?? 0); }
function metaFirst(a = 7, b?: number): number { return a + (b ?? 0); }
function metaRest(a: number, ...tail: number[]): number { return a; }
function observe(target: Numeric): [string, number] { return [target.name, target.length]; }
const targets: Numeric[] = [metaZero, metaOne, metaThree, metaOptional, metaDefault, metaFirst, metaRest];
const expected: [string, number][] = [["metaZero", 0], ["metaOne", 1], ["metaThree", 3], ["metaOptional", 3], ["metaDefault", 1], ["metaFirst", 0], ["metaRest", 1]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 7);
