/*---
description: A callable tuple preserves arrow prototype errors only for object operands, with primitives answering false.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-function-types, ts-errors, ts-instanceof]
---*/
// An arrow and an ordinary function cross callable tuple elements; node throws for arrow object tests and answers false for every primitive.
function Ordinary(): void {}
const arrow: () => unknown = () => 1;
function accepts(value: unknown, target: () => unknown): boolean { return value instanceof target; }
const made: unknown = Object.create(Ordinary.prototype);
const values: [unknown, boolean, boolean][] = [[made, true, true], [{}, true, false], [[], true, false], [() => 1, true, false], [Object.create(null), true, false], [null, false, false], [undefined, false, false], [0, false, false], [false, false, false], ["", false, false], [0n, false, false], [Symbol("x"), false, false]];
const targets: [() => unknown, boolean][] = [[arrow, true], [Ordinary, false]];
for (const [target, invalid] of targets) for (const [value, objectValue, ordinary] of values) {
  if (invalid && objectValue) assert.throws(TypeError, () => accepts(value, target));
  else { const answer = accepts(value, target); assert.sameValue(answer, ordinary); }
}
