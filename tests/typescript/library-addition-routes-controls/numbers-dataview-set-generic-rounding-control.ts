/*---
description: "Control: setFloat16 through a constrained generic receiver; node stores exact rounded half-precision bytes and preserves guards."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-unions, ts-null-undefined]
---*/
// setFloat16 through a constrained generic receiver; node stores exact rounded half-precision bytes and preserves guards.
const log: string[] = [];
function write<T extends DataView>(source: T, value: number, bits: number, little: boolean): void {
  log.push("write"); return source.setUint16(1, bits, little);
}
function read<T extends DataView>(source: T): T { log.push("read"); return source; }
const rows: [number, number | undefined, number][] = [
  [0, 0x0000, 0], [-0, 0x8000, -0], [1.5, 0x3e00, 1.5], [-2.5, 0xc100, -2.5], [0.1, 0x2e66, 0.0999755859375],
  [1.0004882812499998, 0x3c00, 1], [1.00048828125, 0x3c00, 1], [1.0004882812500002, 0x3c01, 1.0009765625],
  [1.00146484375, 0x3c02, 1.001953125], [-1.00048828125, 0xbc00, -1], [-1.00146484375, 0xbc02, -1.001953125],
  [5.960464477539063e-8, 0x0001, 5.960464477539063e-8], [-5.960464477539063e-8, 0x8001, -5.960464477539063e-8],
  [2.9802322387695312e-8, 0x0000, 0], [-2.9802322387695312e-8, 0x8000, -0], [2.980232238769532e-8, 0x0001, 5.960464477539063e-8],
  [0.00006097555160522461, 0x03ff, 0.00006097555160522461], [0.000061005353927612305, 0x0400, 0.00006103515625],
  [65504, 0x7bff, 65504], [65519.99999999999, 0x7bff, 65504], [65520, 0x7c00, Infinity], [-65520, 0xfc00, -Infinity],
  [Infinity, 0x7c00, Infinity], [-Infinity, 0xfc00, -Infinity], [Number.MIN_VALUE, 0x0000, 0], [-Number.MIN_VALUE, 0x8000, -0], [NaN, undefined, NaN]
];
for (const row of rows) for (const little of [false, true]) {
  log.length = 0;
  const buffer = new ArrayBuffer(10), bytes = new Uint8Array(buffer); bytes.fill(165);
  const view = new DataView(buffer, 2, 6), bits = row[1] === undefined ? 0x7e00 : row[1];
  const result = write(view, row[0], bits, little), after = read(view);
  assert.compareArray(log, ["write", "read"]);
  assert.sameValue(Object.is(result, undefined), true); assert.sameValue(typeof result, "undefined");
  assert.sameValue(after, view); assert.sameValue(after.buffer, buffer); assert.sameValue(after.byteOffset, 2); assert.sameValue(after.byteLength, 6);
  const high = bits >> 8, low = bits & 255, expected = little ? [165, 165, 165, low, high, 165, 165, 165, 165, 165] : [165, 165, 165, high, low, 165, 165, 165, 165, 165];
  for (let index = 0; index < bytes.length; index++) if (row[1] !== undefined || index < 3 || index > 4) assert.sameValue(bytes[index], expected[index]);
  const nativeLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1, copy = new Uint8Array(2);
  copy[0] = bytes[nativeLittle === !!little ? 3 : 4]; copy[1] = bytes[nativeLittle === !!little ? 4 : 3];
  const stored = new Float16Array(copy.buffer)[0]; assert.sameValue(stored, row[2]); assert.sameValue(typeof stored, "number");
}
