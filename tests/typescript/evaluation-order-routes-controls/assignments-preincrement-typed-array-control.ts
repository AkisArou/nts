/*---
description: "Control for assignments-preincrement-typed-array; Prefix typed-array increment reads after key effects but writes the view selected before those effects."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-typed-array-conversion, ts-unions, ts-tuples, ts-conversions, ts-closures, ts-type-aliases, ts-typeof-operator]
---*/
// A typed-array union carries ++ through a computed index; node reads the key-mutated element, returns its unwrapped increment, and writes the originally selected view. The control saves each step in order.
const log: string[] = [];
type Values = Uint8Array | Float64Array;
const rows: [number, number, number, number, number][] = [[1, 255, 256, 0, 256], [8, 0, 1, 1, 1], [0, 4.5, 5, 5, 5.5]];
for (const Type of [Uint8Array, Float64Array]) for (const row of rows) {
  const first: Values = new Type([row[0], 77]), second: Values = new Type([90, 91]); let active: Values = first;
  function target(): Values { log.push("view"); return active; }
  function key(): number { log.push(`key:${first[0]}`); first[0] = row[1]; active = second; return 0; }
  function run(): number { log.push("run"); const receiver = target();
    const index = key();
    const before = receiver[index];
    let numeric = before;
    const result = ++numeric;
    receiver[index] = numeric;
    return result; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "view", `key:${row[0]}`]);
  assert.sameValue(result, Type === Uint8Array ? row[2] : row[4]); assert.sameValue(typeof result, "number");
  assert.sameValue(first[0], Type === Uint8Array ? row[3] : row[4]); assert.sameValue(first[1], 77);
  assert.sameValue(second[0], 90); assert.sameValue(second[1], 91); assert.sameValue(active, second);
}
