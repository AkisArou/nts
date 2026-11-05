/*---
description: "Uint32 explicit byte orders preserve large unsigned values and modulo results with exact independent bytes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Uint32 explicit byte orders preserve large unsigned values and modulo results with exact independent bytes. Route: a constrained byte-order helper at boolean and record type arguments. Node prints integers-uint32-generic-endian:ok.
type View = DataView;
function check<T extends boolean | { little: boolean }>(input: T, value: number, expected: number, expectedBytes: readonly number[]): void {
  const little = typeof input === "boolean" ? input : input.little, view: View = new DataView(new ArrayBuffer(4));
  view.setUint32(0, value, little);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getUint32(0, little), expected);
}
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [2309737967, 2309737967, [137, 171, 205, 239], [239, 205, 171, 137]],
  [2147483649, 2147483649, [128, 0, 0, 1], [1, 0, 0, 128]],
  [-2, 4294967294, [255, 255, 255, 254], [254, 255, 255, 255]], [4294967297, 1, [0, 0, 0, 1], [1, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  check<boolean>(order, value, expected, order ? little : big);
  check<{ little: boolean }>({ little: order }, value, expected, order ? little : big);
}
console.log("integers-uint32-generic-endian:ok");
