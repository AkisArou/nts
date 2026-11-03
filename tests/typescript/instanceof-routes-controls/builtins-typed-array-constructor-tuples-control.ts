/*---
description: Typed-array constructors in tuples distinguish every element family and prototype-only objects. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-interfaces, ts-functions, ts-type-aliases, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-unknown, ts-symbols, ts-bigint, ts-narrowing, ts-typeof-operator]
---*/
// Twelve typed-array targets and values cross ViewRow tuples; node matches only the selected chain and accepts handmade descendants of each prototype. The control walks prototypes explicitly.
function follows(value: unknown, prototype: object): boolean {
  let step: unknown = value;
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    step = Object.getPrototypeOf(step);
    if (step === prototype) return true;
  }
  return false;
}
interface ViewTarget { readonly prototype: object; [Symbol.hasInstance](value: unknown): boolean; }
type ViewRow = [target: ViewTarget, value: unknown];
const rows: ViewRow[] = [
  [Int8Array, new Int8Array(1)], [Uint8Array, new Uint8Array(1)], [Uint8ClampedArray, new Uint8ClampedArray(1)],
  [Int16Array, new Int16Array(1)], [Uint16Array, new Uint16Array(1)], [Int32Array, new Int32Array(1)], [Uint32Array, new Uint32Array(1)],
  [Float16Array, new Float16Array(1)], [Float32Array, new Float32Array(1)], [Float64Array, new Float64Array(1)],
  [BigInt64Array, new BigInt64Array(1)], [BigUint64Array, new BigUint64Array(1)]
];
for (let selected = 0; selected < rows.length; selected++) {
  const [target, value] = rows[selected], handmade: unknown = Object.create(target.prototype);
  for (let candidate = 0; candidate < rows.length; candidate++) {
    const choice = rows[candidate][0], matched = follows(value, choice.prototype);
    assert.sameValue(matched, candidate === selected);
  }
  const samples: [unknown, boolean][] = [[handmade, true], [target.prototype, false], [[], false], [new DataView(new ArrayBuffer(1)), false], [0n, false], [null, false]];
  for (const [candidate, expected] of samples) {
    const matched = follows(candidate, target.prototype);
    assert.sameValue(matched, expected);
  }
}
