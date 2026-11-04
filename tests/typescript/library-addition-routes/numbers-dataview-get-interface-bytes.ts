/*---
description: "getFloat16 through an interface accessor; node reads the selected view once and keeps its exact bytes and geometry."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-functions, ts-iteration, ts-typeof-operator, ts-interfaces, ts-accessors, ts-objects, ts-closures]
---*/
// getFloat16 through an interface accessor; node reads the selected view once and keeps its exact bytes and geometry.
const log: string[] = [];
interface Source { view: DataView; }
function read(source: Source, expected: number, little: boolean): number {
  log.push("read"); return source.view.getFloat16(1, little);
}
const rows: [number, number][] = [
  [0x0000, 0], [0x8000, -0], [0x3c00, 1], [0xbc00, -1], [0x3e00, 1.5], [0xc100, -2.5], [0x2e66, 0.0999755859375],
  [0x3c01, 1.0009765625], [0x3c02, 1.001953125], [0x0001, 5.960464477539063e-8], [0x8001, -5.960464477539063e-8],
  [0x0002, 1.1920928955078125e-7], [0x03ff, 0.00006097555160522461], [0x0400, 0.00006103515625],
  [0x7bff, 65504], [0xfbff, -65504], [0x7c00, Infinity], [0xfc00, -Infinity], [0x7e00, NaN], [0xfe01, NaN], [0x7c01, NaN]
];
for (const row of rows) for (const little of [false, true]) {
  log.length = 0;
  const buffer = new ArrayBuffer(10), bytes = new Uint8Array(buffer); bytes.fill(165);
  const view = new DataView(buffer, 2, 6); view.setUint16(1, row[0], little);
  const before = Array.from(bytes);
  const source: Source = { get view(): DataView { log.push("view"); return view; } };
  const result = read(source, row[1], little), after = source.view;
  assert.compareArray(log, ["read", "view", "view"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "number");
  assert.sameValue(after, view); assert.sameValue(after.buffer, buffer); assert.sameValue(after.byteOffset, 2); assert.sameValue(after.byteLength, 6);
  assert.compareArray(Array.from(bytes), before);
  const high = row[0] >> 8, low = row[0] & 255;
  assert.compareArray(before, little ? [165, 165, 165, low, high, 165, 165, 165, 165, 165] : [165, 165, 165, high, low, 165, 165, 165, 165, 165]);
}
