/*---
description: "Computed symbol assignment retains the selected key through an RHS that chooses another key."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-unions, ts-discriminated-unions, ts-narrowing, ts-symbols, ts-computed-keys, ts-literal-types, ts-objects, ts-closures, ts-type-aliases, ts-typeof-operator]
---*/
// A discriminated union carries a symbol-keyed target; node narrows the route, evaluates the key once, then writes the original key after the RHS changes selection.
const log: string[] = [];
const first = Symbol("first"), second = Symbol("second");
interface Cell { [first]: number; [second]: number; }
type Route = { kind: "left"; left: Cell } | { kind: "right"; right: Cell };
function target(route: Route): Cell { log.push(`target:${route.kind}`); if (route.kind === "left") return route.left; return route.right; }
for (const side of ["left", "right"]) for (const value of [-2, 0, 9]) {
  const cell: Cell = { [first]: 1, [second]: 2 };
  const route: Route = side === "left" ? { kind: "left", left: cell } : { kind: "right", right: cell };
  let selected: typeof first | typeof second = first;
  function key(): typeof first | typeof second { log.push("key:first"); return selected; }
  function rhs(): number { log.push("rhs"); selected = second; cell[first] = 100; return value; }
  function run(): number { log.push("run"); return target(route)[key()] = rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", `target:${side}`, "key:first", "rhs"]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(cell[first], value); assert.sameValue(cell[second], 2); assert.sameValue(Object.is(selected, second), true); assert.sameValue(typeof selected, "symbol");
}
