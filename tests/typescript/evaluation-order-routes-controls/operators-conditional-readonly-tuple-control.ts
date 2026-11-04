/*---
description: Control: Conditional branches retain the test effect and skip the unchosen branch.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-readonly, ts-tuples, ts-interfaces, ts-accessors, ts-objects, ts-symbols, ts-unions, ts-type-aliases, ts-functions, ts-arrays, ts-iteration, ts-expressions, ts-numbers, ts-null-undefined]
---*/
// ?: through a readonly tuple element; node reads one branch only and never converts an object test.
const log: string[] = [];
interface Hook { [Symbol.toPrimitive](hint: string): number; }
type Choice = number | null | Hook;
interface Branches { readonly test: Choice; readonly yes: number; readonly no: number; }
const trap: Hook = { [Symbol.toPrimitive](hint: string): number { log.push("forbidden:" + hint); throw new TypeError("conversion"); } };
function choose(route: readonly [Branches]): number {
  log.push("choose");
  const test = route[0].test;
  if (test) {
    const yes = route[0].yes;
    return yes;
  }
  const no = route[0].no;
  return no;
}
const rows: [Choice, number, string][] = [[trap, 7, "yes"], [0, 9, "no"], [NaN, 9, "no"], [null, 9, "no"]];
for (const row of rows) {
  let state = 0;
  const source: Branches = {
    get test(): Choice { log.push("test"); state = 1; return row[0]; },
    get yes(): number { log.push("yes:" + state); state = 7; return state; },
    get no(): number { log.push("no:" + state); state = 9; return state; }
  };
  log.length = 0;
  const result = choose([source]);
  assert.compareArray(log, ["choose", "test", row[2] + ":1"]);
  assert.sameValue(result, row[1]);
  assert.sameValue(state, row[1]);
}
