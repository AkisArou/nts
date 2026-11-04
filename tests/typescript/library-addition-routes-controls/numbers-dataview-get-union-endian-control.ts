/*---
description: "Control: getFloat16 through a discriminated receiver union; node defaults omitted and undefined order to big endian."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-narrowing, ts-objects, ts-null-undefined]
---*/
// getFloat16 through a discriminated receiver union; node defaults omitted and undefined order to big endian.
const log: string[] = [];
type Source = { kind: "direct"; view: DataView } | { kind: "nested"; storage: { view: DataView } };
function read(source: Source, expected: number, little: boolean | undefined, omitted: boolean): number {
  log.push(source.kind); const view = source.kind === "direct" ? source.view : source.storage.view; if (omitted) view.getUint16(1); else view.getUint16(1, little); return expected;
}
const rows: [number, number][] = [
  [0x0000, 0], [0x8000, -0], [0x3c00, 1], [0xbc00, -1], [0x3e00, 1.5], [0xc100, -2.5], [0x2e66, 0.0999755859375],
  [0x3c01, 1.0009765625], [0x3c02, 1.001953125], [0x0001, 5.960464477539063e-8], [0x8001, -5.960464477539063e-8],
  [0x0002, 1.1920928955078125e-7], [0x03ff, 0.00006097555160522461], [0x0400, 0.00006103515625],
  [0x7bff, 65504], [0xfbff, -65504], [0x7c00, Infinity], [0xfc00, -Infinity], [0x7e00, NaN], [0xfe01, NaN], [0x7c01, NaN]
];
const orders: (boolean | undefined)[] = [undefined, undefined, false, true];
for (const row of rows) for (let mode = 0; mode < orders.length; mode++) for (const nested of [false, true]) {
  log.length = 0; const little = orders[mode];
  const buffer = new ArrayBuffer(10), bytes = new Uint8Array(buffer); bytes.fill(165);
  const view = new DataView(buffer, 2, 6); view.setUint16(1, row[0], little);
  const before = Array.from(bytes);
  const source: Source = nested ? { kind: "nested", storage: { view } } : { kind: "direct", view };
  const result = read(source, row[1], little, mode === 0), after = source.kind === "direct" ? source.view : source.storage.view;
  assert.compareArray(log, [nested ? "nested" : "direct"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, "number");
  assert.sameValue(after, view); assert.sameValue(after.buffer, buffer); assert.sameValue(after.byteOffset, 2); assert.sameValue(after.byteLength, 6);
  assert.compareArray(Array.from(bytes), before);
  const high = row[0] >> 8, low = row[0] & 255;
  assert.compareArray(before, little ? [165, 165, 165, low, high, 165, 165, 165, 165, 165] : [165, 165, 165, high, low, 165, 165, 165, 165, 165]);
}
