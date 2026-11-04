/*---
description: Control: Unary bitwise-not converts after a typed method has changed the operand state.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-interfaces, ts-class, ts-functions, ts-objects, ts-unions, ts-tuples, ts-arrays, ts-iteration, ts-conversions, ts-to-primitive, ts-expressions, ts-errors, ts-numbers]
---*/
// Unary ~ over a typed method return; node finishes the mutating call before conversion and skips conversion after a throw.
const log: string[] = [];
interface Hook { valueOf(): number; }
interface Reader { take(): Hook | number; }
let current = 0;
class Box implements Hook {
  valueOf(): number { log.push("convert:class:" + current); return ++current; }
}
const literal: Hook = { valueOf(): number { log.push("convert:literal:" + current); return ++current; } };
const rows: [Hook | number, boolean, string[]][] = [
  [new Box(), false, ["convert:class:4"]], [literal, false, ["convert:literal:4"]], [5, false, []], [new Box(), true, []]
];
for (const row of rows) {
  const source: Reader = { take(): Hook | number { log.push("take"); current = 4; if (row[1]) throw new RangeError("take"); return row[0]; } };
  function run(): number {
    log.push("run");
    const receiver = source;
    const take = receiver.take;
    const value = take.call(receiver);
    return ~value;
  }
  log.length = 0; current = 0;
  if (row[1]) {
    assert.throws(RangeError, run);
    assert.compareArray(log, ["run", "take"]);
  } else {
    const result = run();
    assert.compareArray(log, ["run", "take", ...row[2]]);
    assert.sameValue(result, -6);
  }
  assert.sameValue(current, row[2].length === 0 ? 4 : 5);
}
