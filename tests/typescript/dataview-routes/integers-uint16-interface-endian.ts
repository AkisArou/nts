/*---
description: "Uint16 explicit byte orders produce different bytes for asymmetric and wrapped values through both implementations."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Uint16 explicit byte orders produce different bytes for asymmetric and wrapped values through both implementations. Route: an interface with big-endian and little-endian implementations. Node prints integers-uint16-interface-endian:ok.
type View = DataView;
interface WordAccess { write(view: View, value: number): void; read(view: View): number; }
class BigWord implements WordAccess {
  write(view: View, value: number): void { view.setUint16(0, value, false); }
  read(view: View): number { return view.getUint16(0, false); }
}
class LittleWord implements WordAccess {
  write(view: View, value: number): void { view.setUint16(0, value, true); }
  read(view: View): number { return view.getUint16(0, true); }
}
const routes: readonly [WordAccess, boolean][] = [[new BigWord(), false], [new LittleWord(), true]];
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [4660, 4660, [18, 52], [52, 18]], [33023, 33023, [128, 255], [255, 128]],
  [65537, 1, [0, 1], [1, 0]], [-2, 65534, [255, 254], [254, 255]]
];
for (const [route, order] of routes) for (const [value, expected, big, little] of rows) {
  const view: View = new DataView(new ArrayBuffer(2)); route.write(view, value);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, order ? little : big); assert.sameValue(route.read(view), expected);
}
console.log("integers-uint16-interface-endian:ok");
