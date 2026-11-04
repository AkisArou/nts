/*---
description: "Typed-array assignment retains its view and index but returns the value before element conversion."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-typed-array-conversion, ts-unions, ts-tuples, ts-conversions, ts-closures, ts-type-aliases, ts-typeof-operator]
---*/
// A Uint8Array or Float64Array union carries computed =; node runs view/index/RHS and returns the raw RHS while Uint8Array wraps the stored element.
const log: string[] = [];
type Values = Uint8Array | Float64Array;
const rows: [number, number][] = [[-1, 255], [257, 1], [3.5, 3], [-0, 0]];
for (const Type of [Uint8Array, Float64Array]) for (const row of rows) {
  const original: Values = new Type([11, 22]), other: Values = new Type([90, 91]); let active: Values = original; let index = 0;
  function target(): Values { log.push("view"); return active; }
  function key(): number { log.push(`index:${index}`); const saved = index; index = 1; return saved; }
  function rhs(): number { log.push(`rhs:${index}`); original[0] = 199; active = other; return row[0]; }
  function run(): number { log.push("run"); return target()[key()] = rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "view", "index:0", "rhs:1"]);
  assert.sameValue(result, row[0]); assert.sameValue(typeof result, "number");
  assert.sameValue(original[0], Type === Uint8Array ? row[1] : row[0]); assert.sameValue(original[1], 22);
  assert.sameValue(other[0], 90); assert.sameValue(other[1], 91); assert.sameValue(active, other); assert.sameValue(index, 1);
}
