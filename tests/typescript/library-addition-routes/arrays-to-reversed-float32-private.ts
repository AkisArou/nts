/*---
description: "Float32Array.toReversed preserves exact converted contents and separate storage through private."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-typed-array-methods, ts-typed-array-conversion, ts-conversions, ts-instanceof, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/
// Float32Array.toReversed crosses the private route; node reverses only the view, retains its element kind, and leaves its source and storage unchanged.
const log: string[] = [];
class Carrier {
  #view: Float32Array;
  constructor(view: Float32Array) { this.#view = view; }
  check(before: number[], expected: number[]): void {
    const source = this.#view;
    const buffer = source.buffer, offset = source.byteOffset, bytes = source.byteLength; log.length = 0;
    const result = source.toReversed();
    const again = this.#view;
    assert.compareArray(log, []);
    assert.sameValue(again, source); assert.sameValue(result === source, false); assert.sameValue(result instanceof Float32Array, true); assert.sameValue(Array.isArray(result), false);
    assert.compareArray(Array.from(result), expected); assert.sameValue(result.length, before.length);
    assert.sameValue(result.buffer === buffer, false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, before.length * 4);
    assert.compareArray(Array.from(again), before); assert.sameValue(again.buffer, buffer); assert.sameValue(again.byteOffset, offset); assert.sameValue(again.byteLength, bytes); assert.sameValue(again.length, before.length);
    if (result.length > 0) result[0] = 99;
    assert.compareArray(Array.from(again), before);
  }
}
const rows: [number[], number[], number[]][] = [[[], [], []], [[-0], [-0], [-0]], [[0.1, -0, NaN, Infinity, -Infinity, 16777217, 1 + 2 ** -24], [0.10000000149011612, -0, NaN, Infinity, -Infinity, 16777216, 1], [1, 16777216, -Infinity, Infinity, NaN, -0, 0.10000000149011612]]];
for (const [raw, before, expected] of rows) {
  const buffer = new ArrayBuffer((raw.length + 2) * 4), view = new Float32Array(buffer, 4, raw.length); view.set(raw);
  new Carrier(view).check(before, expected);
}
