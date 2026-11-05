/*---
description: "Fill counts negative bounds from the end and converts only the selected byte elements. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-map-set, ts-tuples]
---*/

function localUint8Array(length: number): number[] { const result: number[] = []; for (let i = 0; i < length; i++) result[i] = 0; return result; }
function localBound(index: number, length: number): number { if (index < 0) index += length; return index < 0 ? 0 : index > length ? length : index; }
function localFill(data: number[], value: number, start: number, end: number): number[] { for (let i = localBound(start, data.length); i < localBound(end, data.length); i++) data[i] = (value % 256 + 256) % 256; return data; }
// Fill counts negative bounds from the end and converts only the selected byte elements. Route: byte arrays retrieved through guarded Map.get.
// Node prints conversion-fill-negative-map:ok.
type Bytes = number[];
const rows: readonly [number, number, readonly number[]][] = [[-3, -1, [0, 0, 7, 7, 0]], [-9, 1, [7, 0, 0, 0, 0]], [3, 1, [0, 0, 0, 0, 0]], [-1, 9, [0, 0, 0, 0, 7]]];
const byteRoutes: Map<number, Bytes> = new Map(); for (let i = 0; i < rows.length; i++) byteRoutes.set(i, localUint8Array(5));
for (let row = 0; row < rows.length; row++) {
  const data = byteRoutes.get(row); if (data === undefined) throw new Error("missing byte route");
  const [start, end, expected] = rows[row]; const returned = localFill(data, 263, start, end);
  assert.sameValue(returned === data, true);
  const actual: number[] = []; for (let i = 0; i < data.length; i++) actual[i] = data[i]; assert.compareArray(actual, expected);
}
console.log("conversion-fill-negative-map:ok");
