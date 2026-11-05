/*---
description: "Float64 getters retain signed subnormals and minimal normal values from independent literal bytes through two reader interface implementations. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [Number.MIN_VALUE, 5e-324, [0, 0, 0, 0, 0, 0, 0, 1]],
  [-Number.MIN_VALUE, -5e-324, [128, 0, 0, 0, 0, 0, 0, 1]],
  [2.2250738585072014e-308, 2.2250738585072014e-308, [0, 16, 0, 0, 0, 0, 0, 0]],
  [-2.2250738585072014e-308, -2.2250738585072014e-308, [128, 16, 0, 0, 0, 0, 0, 0]],
];
function localGetFloat64(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat64) { let matches: boolean = true;
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== entry[2][little ? 7 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float64 getters retain signed subnormals and minimal normal values from independent literal bytes; route: two reader interface implementations. Node prints floats-f64-get-subnormal-interface:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
interface FloatReader { read(view: View): number; }
class BigReader implements FloatReader { read(view: View): number { return localGetFloat64(view, 0, false); } }
class LittleReader implements FloatReader { read(view: View): number { return localGetFloat64(view, 0, true); } }
const plans: readonly [FloatReader, boolean][] = [[new BigReader(), false], [new LittleReader(), true]];
const rows: readonly [number, readonly number[]][] = [
  [5e-324, [0, 0, 0, 0, 0, 0, 0, 1]],
  [-5e-324, [128, 0, 0, 0, 0, 0, 0, 1]],
  [2.2250738585072014e-308, [0, 16, 0, 0, 0, 0, 0, 0]],
  [-2.2250738585072014e-308, [128, 16, 0, 0, 0, 0, 0, 0]],
];
for (const [reader, little] of plans) for (const [expected, encoded] of rows) {
  const input: number[] = [];
  for (let i = 0; i < 8; i++) input[i] = encoded[little ? 7 - i : i];
  assert.sameValue(reader.read(seeded(input)), expected);
}
console.log("floats-f64-get-subnormal-interface:ok");
