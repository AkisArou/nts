/*---
description: "Call arguments preserve Uint8Array snapshots around an intervening write."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-typed-array-contents, ts-tuples, ts-template-literals, ts-typed-array-conversion]
---*/
// A Uint8Array parameter carries all three argument steps; node reads the old element, performs the write and then reads the stored new element before entering the callee.
const log: string[] = [];
function read(view: Uint8Array): number { log.push(`read:${view[0]}`); return view[0]; }
function write(view: Uint8Array, value: number): number { log.push(`write:${value}`); view[0] = value; return value; }
function collect(a: number, b: number, c: number): number[] { log.push("collect"); return [a, b, c]; }
function run(view: Uint8Array, value: number): number[] { log.push("run"); return collect(read(view), write(view, value), read(view)); }
const rows: [number, number, number][] = [[7, 257, 1], [7, -1, 255], [7, 1.5, 1], [7, 0, 0]];
for (const row of rows) {
  const view = new Uint8Array([row[0]]); log.length = 0; const result = run(view, row[1]);
  assert.compareArray(log, ["run", `read:${row[0]}`, `write:${row[1]}`, `read:${row[2]}`, "collect"]);
  assert.compareArray(result, row); assert.sameValue(result[0], row[0]); assert.sameValue(result[1], row[1]); assert.sameValue(result[2], row[2]); assert.sameValue(view[0], row[2]); assert.sameValue(view.length, 1);
}
