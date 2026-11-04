/*---
description: "Postfix typed-array decrement returns the key-mutated old element and converts only the new store."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-typed-array-conversion, ts-unions, ts-tuples, ts-conversions, ts-closures, ts-type-aliases, ts-typeof-operator]
---*/
// A typed-array union carries computed --; node retains the original view, reads after key effects, and returns its old number including Float64 negative zero.
const log: string[] = [];
type Values = Uint8Array | Float64Array;
const rows: [number, number, number, number][] = [[0, 0, 255, -1], [257, 1, 0, 256], [-0, 0, 255, -1], [-1.5, 255, 254, -2.5]];
for (const Type of [Uint8Array, Float64Array]) for (const row of rows) {
  const first: Values = new Type([44, 77]), second: Values = new Type([90, 91]); let active: Values = first;
  function target(): Values { log.push("view"); return active; }
  function key(): number { log.push("key:44"); first[0] = row[0]; active = second; return 0; }
  function run(): number { log.push("run"); return target()[key()]--; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "view", "key:44"]);
  assert.sameValue(result, Type === Uint8Array ? row[1] : row[0]); assert.sameValue(typeof result, "number");
  assert.sameValue(first[0], Type === Uint8Array ? row[2] : row[3]); assert.sameValue(first[1], 77);
  assert.sameValue(second[0], 90); assert.sameValue(second[1], 91); assert.sameValue(active, second);
}
