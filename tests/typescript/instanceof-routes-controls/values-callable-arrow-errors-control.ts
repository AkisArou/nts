/*---
description: A callable tuple preserves arrow prototype errors only for object operands, with primitives answering false. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-function-types, ts-errors]
---*/
// An arrow and an ordinary function cross callable tuple elements; node throws for arrow object tests and answers false for every primitive. The control makes the specified walk or error explicit.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
function Ordinary(): void {}
const arrow: () => unknown = () => 1;
function accepts(value: unknown, target: () => unknown): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  const prototype: unknown = target.prototype;
  if ((typeof prototype !== "object" || prototype === null) && typeof prototype !== "function") throw new TypeError();
  return follows(value, prototype);
}
const made: unknown = Object.create(Ordinary.prototype);
const values: [unknown, boolean, boolean][] = [[made, true, true], [{}, true, false], [[], true, false], [() => 1, true, false], [Object.create(null), true, false], [null, false, false], [undefined, false, false], [0, false, false], [false, false, false], ["", false, false], [0n, false, false], [Symbol("x"), false, false]];
const targets: [() => unknown, boolean][] = [[arrow, true], [Ordinary, false]];
for (const [target, invalid] of targets) for (const [value, objectValue, ordinary] of values) {
  if (invalid && objectValue) assert.throws(TypeError, () => accepts(value, target));
  else { const answer = accepts(value, target); assert.sameValue(answer, ordinary); }
}
