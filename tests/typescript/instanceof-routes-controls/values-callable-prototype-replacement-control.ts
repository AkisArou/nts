/*---
description: A callable parameter observes each current prototype value and throws only after an object left operand arrives. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-function-types, ts-interfaces, ts-errors]
---*/
// An ordinary function with an unknown prototype field crosses CallableTarget parameters; node walks object prototypes and rejects primitive prototypes. The control makes the specified walk or error explicit.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
interface CallableTarget { (): void; prototype: unknown; }
const target: CallableTarget = function Target(): void {};
function accepts(value: unknown, candidate: CallableTarget): boolean { if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  const prototype = candidate.prototype;
  if ((typeof prototype !== "object" || prototype === null) && typeof prototype !== "function") throw new TypeError();
  return follows(value, prototype); }
const root = {}, callableRoot = () => 1;
const prototypes: [unknown, boolean][] = [[root, true], [callableRoot, true], [null, false], [undefined, false], [false, false], [0, false], [NaN, false], ["x", false], [0n, false], [Symbol("prototype"), false]];
for (const [prototype, valid] of prototypes) {
  target.prototype = prototype;
  const made: unknown = Object.create(((typeof prototype === "object" && prototype !== null) || typeof prototype === "function") ? prototype : root);
  const objects: [unknown, boolean][] = [[made, true], [{}, false], [[], false], [() => 1, false]];
  for (const [value, expected] of objects) {
    if (!valid) assert.throws(TypeError, () => accepts(value, target));
    else { const answer = accepts(value, target); assert.sameValue(answer, expected); }
  }
  for (const value of [null, undefined, false, 0, "", 0n, Symbol("left")]) {
    const answer = accepts(value, target); assert.sameValue(answer, false);
  }
}
