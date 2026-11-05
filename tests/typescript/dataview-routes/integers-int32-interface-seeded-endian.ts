/*---
description: "Seeded asymmetric words produce exact signed Int32 results in each byte order without a matching-width setter."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Seeded asymmetric words produce exact signed Int32 results in each byte order without a matching-width setter. Route: an interface with two byte-order reader implementations. Node prints integers-int32-interface-seeded-endian:ok.
type View = DataView;
interface WordReader { read(view: View): number; }
class BigWord implements WordReader { read(view: View): number { return view.getInt32(0, false); } }
class LittleWord implements WordReader { read(view: View): number { return view.getInt32(0, true); } }
const routes: readonly WordReader[] = [new BigWord(), new LittleWord()];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[128, 0, 0, 1], [-2147483647, 16777344]], [[1, 0, 0, 128], [16777344, -2147483647]],
  [[255, 255, 255, 254], [-2, -16777217]], [[127, 255, 255, 255], [2147483647, -129]]
];
for (const [seed, expected] of rows) {
  const view: View = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) view.setUint8(i, seed[i]);
  const actual: number[] = []; for (let i = 0; i < routes.length; i++) actual[i] = routes[i].read(view);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
}
console.log("integers-int32-interface-seeded-endian:ok");
