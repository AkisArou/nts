/*---
description: "Int8Array.with converts its replacement before bounds checks through private."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-typed-array-methods, ts-typed-array-conversion, ts-conversions, ts-instanceof, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-objects, ts-unions, ts-null-undefined, ts-errors, ts-unknown, ts-narrowing, ts-to-primitive, ts-unsound-object-assign]
---*/
// Int8Array.with crosses the private route; node converts a primitive or logged object before RangeError, wraps or rounds valid stores, and leaves the original view unchanged.
const log: string[] = [];
class Carrier {
  #view: Int8Array;
  constructor(view: Int8Array) { this.#view = view; }
  check(index: number, replacement: number, stored: number, target: number | undefined, mode: string): void {
    const source = this.#view;
    const before = Array.from(source), buffer = source.buffer, offset = source.byteOffset, bytes = source.byteLength;
    const slot: { value: number } = { value: replacement };
    if (mode !== "primitive") Object.assign(slot, { value: { valueOf(): number | object { log.push("valueOf"); return mode === "fallback" ? this : replacement; }, toString(): string { log.push("toString"); return Object.is(replacement, -0) ? "-0" : String(replacement); } } });
    log.length = 0; let output: Int8Array | undefined; let caught: unknown;
    try {
      const result = source.with(index, slot.value);
      output = result;
    } catch (error) { caught = error; }
    const again = this.#view;
    const expectedLog: string[] = mode === "primitive" ? [] : mode === "fallback" ? ["valueOf", "toString"] : ["valueOf"];
    assert.compareArray(log, expectedLog);
    assert.sameValue(caught instanceof RangeError, target === undefined); assert.sameValue(caught === undefined, target !== undefined); assert.sameValue(output === undefined, target === undefined);
    assert.sameValue(again, source); assert.compareArray(Array.from(again), before); assert.sameValue(again.buffer, buffer); assert.sameValue(again.byteOffset, offset); assert.sameValue(again.byteLength, bytes); assert.sameValue(again.length, before.length);
    if (output !== undefined) {
      const expected: number[] = []; for (let k = 0; k < before.length; k++) expected.push(k === target ? stored : before[k]);
      assert.sameValue(output === source, false); assert.sameValue(output instanceof Int8Array, true); assert.compareArray(Array.from(output), expected); assert.sameValue(output.length, before.length);
      assert.sameValue(output.buffer === buffer, false); assert.sameValue(output.byteOffset, 0); assert.sameValue(output.byteLength, before.length * 1);
      output[0] = 99; assert.compareArray(Array.from(again), before);
    }
  }
}
const values: [number, number][] = [[128, -128], [255, -1], [-129, 127], [257, 1], [-3.9, -3], [NaN, 0], [-0, 0]];
const indices: [number, number | undefined][] = [[-0, 0], [-0.75, 0], [NaN, 0], [1.9, 1], [-1, 3], [-1.9, 3], [-4, 0], [-4.9, 0], [3.9, 3], [4, undefined], [-5, undefined], [Infinity, undefined], [-Infinity, undefined]];
for (const [replacement, stored] of values) for (const mode of ["primitive", "valueOf", "fallback"]) for (const [index, selected] of indices) for (const length of [0, 4]) {
  const buffer = new ArrayBuffer((length + 2) * 1), view = new Int8Array(buffer, 1, length);
  for (let k = 0; k < length; k++) view[k] = k + 1;
  new Carrier(view).check(index, replacement, stored, length === 0 ? undefined : selected, mode);
}
