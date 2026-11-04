/*---
description: Control: Subtract retains operand reads before ordered conversions and abrupt completion.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-interfaces, ts-accessors, ts-objects, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-numbers, ts-bigint, ts-conversions, ts-to-primitive, ts-symbols, ts-unsound-object-assign]
---*/
// - through interface slots; node reads both operands before conversions and mixed kinds throw only afterwards.
const log: string[] = [];
interface Operands { left: number; right: number; }
let phase = 0;
function calculate(source: Operands): number {
  log.push("calculate");
  const left = source.left;
  const right = source.right;
  return left - right;
}
const rows: [number | bigint, number | bigint, boolean, boolean][] = [
  [8, 2, false, false], [8n, 2, false, false], [8, 2n, false, false],
  [8, 2, true, false], [8, 2, false, true]
];
for (const row of rows) {
  phase = 0;
  const stored: Operands = { left: 0, right: 0 };
  Object.assign(stored, {
    left: row[2] ? row[0] : { valueOf(): number | bigint { log.push("convert:left:" + phase); phase = 30; return row[0]; } },
    right: row[2] ? row[1] : { [Symbol.toPrimitive](hint: string): number | bigint { log.push("convert:right:" + hint + ":" + phase); phase = 40; return row[1]; } }
  });
  const source: Operands = {
    get left(): number { log.push("get:left"); phase = 10; return stored.left; },
    get right(): number { log.push("get:right"); phase = 20; if (row[3]) throw new RangeError("right"); return stored.right; }
  };
  function run(): number { log.push("run"); return calculate(source); }
  log.length = 0;
  const expectedLog = ["run", "calculate", "get:left", "get:right"];
  if (!row[2] && !row[3]) expectedLog.push("convert:left:20", "convert:right:number:30");
  if (row[3]) {
    assert.throws(RangeError, run);
    assert.compareArray(log, expectedLog);
  } else if (typeof row[0] !== typeof row[1]) {
    assert.throws(TypeError, run);
    assert.compareArray(log, expectedLog);
  } else {
    const result = run();
    assert.compareArray(log, expectedLog);
    assert.sameValue(result, 6);
  }
  assert.sameValue(phase, row[2] || row[3] ? 20 : 40);
}
