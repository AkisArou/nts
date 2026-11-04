/*---
description: "Control for assignments-compound-tuple-element; Compound tuple subtraction preserves the original element while RHS mutates its tuple and neighbor."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-closures, ts-literal-types, ts-type-aliases, ts-typeof-operator]
---*/
// A number/string tuple routes -=; node reads the selected element before RHS replacement and retains the neighbor write while storing the saved difference. The control saves each step in order.
const log: string[] = [];
type Pair = [number, string];
for (const initial of [-2, 0, 8]) {
  const first: Pair = [initial, "first"], second: Pair = [90, "second"]; let active: Pair = first;
  function target(): Pair { log.push("tuple"); return active; }
  function key(): 0 { log.push("key:0"); return 0; }
  function rhs(): number { log.push(`rhs:${first[0]}`); first[0] = 100; first[1] = "changed"; active = second; return 3; }
  function run(): number { log.push("run"); const receiver = target();
    const index = key();
    const left = receiver[index];
    const right = rhs();
    const result = left - right;
    receiver[index] = result;
    return result; }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "tuple", "key:0", `rhs:${initial}`]);
  assert.sameValue(result, initial - 3); assert.sameValue(typeof result, "number");
  assert.sameValue(first[0], initial - 3); assert.sameValue(first[1], "changed"); assert.sameValue(first.length, 2);
  assert.sameValue(second[0], 90); assert.sameValue(second[1], "second"); assert.sameValue(active, second);
}
