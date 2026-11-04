/*---
description: Control: Three-stage and preserves skipped effects and selected identities.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-interfaces, ts-unions, ts-type-aliases, ts-accessors, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-numbers, ts-objects, ts-symbols, ts-null-undefined, ts-expressions]
---*/
// && over three interface accessors; node skips conversion hooks and forbidden reads while retaining each selected value.
const log: string[] = [];
interface Hook { [Symbol.toPrimitive](hint: string): number; }
type Choice = number | null | undefined | Hook;
interface Source { readonly first: Choice; readonly second: Choice; readonly third: number; }
const trap: Hook = { [Symbol.toPrimitive](hint: string): number { log.push("forbidden:" + hint); throw new TypeError("conversion"); } };
function choose(source: Source): Choice {
  log.push("choose");
  const first = source.first;
  let result: Choice = first;
  if (first) {
    const second = source.second;
    result = second;
    if (second) {
      const third = source.third;
      result = third;
    }
  }
  return result;
}
const rows: [Choice, Choice, Choice, string[], number][] = [[0, trap, 0, [], 0], [-0, trap, -0, [], 0], [trap, 0, 0, ["second"], 1], [trap, trap, 7, ["second", "third"], 11]];
for (const row of rows) {
  let state = 0;
  const source: Source = {
    get first(): Choice { log.push("first"); return row[0]; },
    get second(): Choice { log.push("second"); state++; return row[1]; },
    get third(): number { log.push("third"); state += 10; return 7; }
  };
  log.length = 0;
  const result = choose(source);
  assert.compareArray(log, ["choose", "first", ...row[3]]);
  assert.sameValue(result, row[2]);
  assert.sameValue(state, row[4]);
}
