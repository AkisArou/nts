/*---
description: "Control for arrays-with-bigint64-static; BigInt64Array.with converts its replacement before bounds checks through static."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-typed-array-methods, ts-typed-array-conversion, ts-conversions, ts-instanceof, ts-bigint, ts-class, ts-class-fields, ts-static, ts-objects, ts-unions, ts-null-undefined, ts-errors, ts-unknown, ts-narrowing, ts-this, ts-to-primitive, ts-unsound-object-assign]
---*/
// BigInt64Array.with crosses the static route; node converts a primitive or logged object before RangeError, wraps or rounds valid stores, and leaves the original view unchanged. The control uses older indexed loops in place of the new method.
const log: string[] = [];
class Carrier { static view: BigInt64Array = new BigInt64Array(0); }
function check(view: BigInt64Array, index: number, replacement: bigint, stored: bigint, target: number | undefined, mode: string): void {
  Carrier.view = view; const source = Carrier.view;
  const before = Array.from(source), buffer = source.buffer, offset = source.byteOffset, bytes = source.byteLength;
  const slot: { value: bigint } = { value: replacement };
  if (mode !== "primitive") Object.assign(slot, { value: { valueOf(): bigint | object { log.push("valueOf"); return mode === "fallback" ? this : replacement; }, toString(): string { log.push("toString"); return Object.is(replacement, -0) ? "-0" : String(replacement); } } });
  log.length = 0; let output: BigInt64Array | undefined; let caught: unknown;
  try {
    const length = source.length, relative = Math.trunc(index) || 0, at = relative < 0 ? length + relative : relative;
    const numeric = new BigInt64Array([slot.value])[0];
    if (at < 0 || at >= length) throw new RangeError();
    const result = new BigInt64Array(length);
    for (let k = 0; k < length; k++) result[k] = k === at ? numeric : source[k];
    output = result;
  } catch (error) { caught = error; }
  const again = Carrier.view;
  const expectedLog: string[] = mode === "primitive" ? [] : mode === "fallback" ? ["valueOf", "toString"] : ["valueOf"];
  assert.compareArray(log, expectedLog);
  assert.sameValue(caught instanceof RangeError, target === undefined); assert.sameValue(caught === undefined, target !== undefined); assert.sameValue(output === undefined, target === undefined);
  assert.sameValue(again, source); assert.compareArray(Array.from(again), before); assert.sameValue(again.buffer, buffer); assert.sameValue(again.byteOffset, offset); assert.sameValue(again.byteLength, bytes); assert.sameValue(again.length, before.length);
  if (output !== undefined) {
    const expected: bigint[] = []; for (let k = 0; k < before.length; k++) expected.push(k === target ? stored : before[k]);
    assert.sameValue(output === source, false); assert.sameValue(output instanceof BigInt64Array, true); assert.compareArray(Array.from(output), expected); assert.sameValue(output.length, before.length);
    assert.sameValue(output.buffer === buffer, false); assert.sameValue(output.byteOffset, 0); assert.sameValue(output.byteLength, before.length * 8);
    output[0] = 99n; assert.compareArray(Array.from(again), before);
  }
}
const values: [bigint, bigint][] = [[9223372036854775808n, -9223372036854775808n], [-9223372036854775809n, 9223372036854775807n], [18446744073709551617n, 1n], [-18446744073709551617n, -1n], [9007199254740993n, 9007199254740993n], [0n, 0n]];
const indices: [number, number | undefined][] = [[-0, 0], [-0.75, 0], [NaN, 0], [1.9, 1], [-1, 3], [-1.9, 3], [-4, 0], [-4.9, 0], [3.9, 3], [4, undefined], [-5, undefined], [Infinity, undefined], [-Infinity, undefined]];
for (const [replacement, stored] of values) for (const mode of ["primitive", "valueOf", "fallback"]) for (const [index, selected] of indices) for (const length of [0, 4]) {
  const buffer = new ArrayBuffer((length + 2) * 8), view = new BigInt64Array(buffer, 8, length);
  for (let k = 0; k < length; k++) view[k] = BigInt(k + 1);
  check(view, index, replacement, stored, length === 0 ? undefined : selected, mode);
}
