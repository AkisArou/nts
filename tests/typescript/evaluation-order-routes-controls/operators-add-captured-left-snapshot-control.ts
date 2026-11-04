/*---
description: Control: Addition retains the captured left value while its right operand assigns the binding.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-closures, ts-functions, ts-tuples, ts-arrays, ts-iteration, ts-expressions, ts-numbers]
---*/
// + over a captured let; node retains the left value before the right assigns 10, yielding old + 10.
const log: string[] = [];
let x: number = 0;
function next(): number { log.push("next:" + x); return 10; }
function calculate(): number {
  log.push("calculate");
  const left = x;
  const value = next();
  const right = (x = value);
  return left + right;
}
const rows: [number, number][] = [[-2, 8], [0, 10], [5, 15]];
for (const row of rows) {
  x = row[0]; log.length = 0;
  const result = calculate();
  assert.compareArray(log, ["calculate", "next:" + row[0]]);
  assert.sameValue(result, row[1]);
  assert.sameValue(x, 10);
}
