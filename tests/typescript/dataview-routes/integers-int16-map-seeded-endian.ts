/*---
description: "The same seeded two bytes have independent signed and unsigned results in both byte orders, without a matching-width setter."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

// The same seeded two bytes have independent signed and unsigned results in both byte orders, without a matching-width setter. Route: a View read through guarded Map.get. Node prints integers-int16-map-seeded-endian:ok.
type View = DataView;
const rows: readonly [readonly number[], readonly number[]][] = [
  [[128, 1], [-32767, 384, 32769, 384]], [[1, 128], [384, -32767, 384, 32769]],
  [[255, 128], [-128, -32513, 65408, 33023]], [[127, 255], [32767, -129, 32767, 65407]]
];
for (const [seed, expected] of rows) {
  const view: View = new DataView(new ArrayBuffer(2)); for (let i = 0; i < 2; i++) view.setUint8(i, seed[i]);
  const views: Map<string, View> = new Map([["word", view]]), stored = views.get("word");
  if (stored === undefined) throw new Error("missing word");
  const actual: number[] = [stored.getInt16(0, false), stored.getInt16(0, true), stored.getUint16(0, false), stored.getUint16(0, true)];
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = stored.getUint8(i);
  assert.compareArray(bytes, seed);
}
console.log("integers-int16-map-seeded-endian:ok");
