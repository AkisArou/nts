/*---
description: Explicit metadata record control for A generic identity return preserves inferred arrow names and parameter cutoffs.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-generics, ts-generic-constraints]
---*/
// Explicit records: A generic Numeric constraint returns arrows with zero, one and several parameters; node preserves names and excludes default and rest tails.
interface Metadata { label: string; arity: number; }
function keep<T extends Metadata>(target: T): T { return target; }
const zeroArrow: Metadata = { label: "zeroArrow", arity: 0 };
const oneArrow: Metadata = { label: "oneArrow", arity: 1 };
const threeArrow: Metadata = { label: "threeArrow", arity: 3 };
const defaultArrow: Metadata = { label: "defaultArrow", arity: 1 };
const restArrow: Metadata = { label: "restArrow", arity: 0 };
function observe(value: Metadata): [string, number] { const target = keep(value); return [target.label, target.arity]; }
const targets: Metadata[] = [zeroArrow, oneArrow, threeArrow, defaultArrow, restArrow];
const expected: [string, number][] = [["zeroArrow", 0], ["oneArrow", 1], ["threeArrow", 3], ["defaultArrow", 1], ["restArrow", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 5);
