/*---
description: Named and inferred function expressions retain metadata when a typed field is replaced.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-function-types, ts-interfaces, ts-default-parameters, ts-rest-parameters]
---*/
// A Slot function field receives anonymous and named expressions; node keeps the original binding or inner name and each parameter cutoff.
type Numeric = (a: number, b: number, c: number) => number;
interface Slot { fn: Numeric; }
const emptyExpression = function (): number { return 0; };
const singleExpression = function (a: number): number { return a; };
const renamedExpression = function innerExpression(a: number, b: number, c: number): number { return a + b + c; };
const stoppedExpression = function (a: number, b = 4, c?: number): number { return a + b + (c ?? 0); };
const restExpression = function (...values: number[]): number { return 0; };
const slot: Slot = { fn: emptyExpression };
function observe(value: Numeric): [string, number] { slot.fn = value; const target = slot.fn; return [target.name, target.length]; }
const targets: Numeric[] = [emptyExpression, singleExpression, renamedExpression, stoppedExpression, restExpression, emptyExpression];
const expected: [string, number][] = [["emptyExpression", 0], ["singleExpression", 1], ["innerExpression", 3], ["stoppedExpression", 1], ["restExpression", 0], ["emptyExpression", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
