/*---
description: "Control for assignments-simple-tuple-element; Tuple element assignment retains the original tuple and selected slot through RHS replacement."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-closures, ts-literal-types, ts-type-aliases, ts-typeof-operator]
---*/
// A declared number/string tuple carries computed =; node logs tuple/key/RHS, keeps the earlier target, and preserves the RHS edit to its neighbor. The control saves each step in order.
const log: string[] = [];
type Pair = [number, string];
for (const value of [-5, 0, 8]) {
  const first: Pair = [1, "first"], second: Pair = [90, "second"]; let active: Pair = first;
  function target(): Pair { log.push("tuple"); return active; }
  function key(): 0 { log.push("key:0"); return 0; }
  function rhs(): number { log.push("rhs"); first[0] = 99; first[1] = "changed"; active = second; return value; }
  function run(): number { log.push("run"); const receiver = target();
    const index = key();
    const value = rhs();
    receiver[index] = value;
    return value; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "tuple", "key:0", "rhs"]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(first[0], value); assert.sameValue(first[1], "changed"); assert.sameValue(first.length, 2);
  assert.sameValue(second[0], 90); assert.sameValue(second[1], "second"); assert.sameValue(active, second);
}
