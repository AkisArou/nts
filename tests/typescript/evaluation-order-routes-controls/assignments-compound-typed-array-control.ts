/*---
description: "Control for assignments-compound-typed-array; Typed-array compound addition reads before mutation and returns the arithmetic result before write conversion."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-typed-array-conversion, ts-unions, ts-tuples, ts-conversions, ts-closures, ts-type-aliases, ts-typeof-operator]
---*/
// A Uint8Array/Float64Array union routes +=; node retains the old element and view across RHS replacement, then wraps only the Uint8Array store. The control saves each step in order.
const log: string[] = [];
type Values = Uint8Array | Float64Array;
const rows: [number, number, number, number][] = [[254, 5, 259, 3], [0, -1, -1, 255], [1, 0.5, 1.5, 1]];
for (const Type of [Uint8Array, Float64Array]) for (const row of rows) {
  const first: Values = new Type([row[0], 77]), second: Values = new Type([90, 91]); let active: Values = first; let index = 0;
  function target(): Values { log.push("view"); return active; }
  function key(): number { log.push(`index:${index}`); const saved = index; index = 1; return saved; }
  function rhs(): number { log.push(`rhs:${first[0]}`); first[0] = 9; active = second; return row[1]; }
  function run(): number { log.push("run"); const receiver = target();
    const index = key();
    const left = receiver[index];
    const right = rhs();
    const result = left + right;
    receiver[index] = result;
    return result; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "view", "index:0", `rhs:${row[0]}`]);
  assert.sameValue(result, row[2]); assert.sameValue(typeof result, "number");
  assert.sameValue(first[0], Type === Uint8Array ? row[3] : row[2]); assert.sameValue(first[1], 77);
  assert.sameValue(second[0], 90); assert.sameValue(second[1], 91); assert.sameValue(active, second); assert.sameValue(index, 1);
}
