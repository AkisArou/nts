/*---
description: Control for storage-recursive-activation-readers; direct reads keep the same input values, operations and observations.
features: [ts-capture-route-storage, ts-closures, ts-functions, ts-function-types, ts-unions, ts-bigint, ts-interfaces, ts-objects, ts-arrays]
---*/
// Control: Both programs retain the same live activation cells; delayed control reads access those cells directly.
type CaptureValue = number | string | boolean | undefined | bigint | { mark: number } | number[];
const captureObject = { mark: 7 }; const captureArray: number[] = [1];
const inputs: CaptureValue[] = [0, -0, NaN, 1.5, 2147483648, "", "latin", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, captureObject, captureArray];
interface RecursiveCaptureCell { value: CaptureValue; }
function checkCapture(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, typeof expected);
}
for (const input of inputs) {
  const log: string[] = []; const cells: RecursiveCaptureCell[] = [];
  const replacements: CaptureValue[] = [input, undefined, 7n];
  function descend(depth: number): void {
    const cell: RecursiveCaptureCell = { value: 1 }; cells.push(cell); log.push("initial:" + depth);
    if (depth < 2) descend(depth + 1);
    cell.value = replacements[depth]; log.push("write:" + depth);
  }
  descend(0);
  for (let i = 0; i < 3; i++) { log.push("read:" + i); const actual = cells[i].value; checkCapture(actual, replacements[i]); }
  cells[1].value = input; log.push("outside:1");
  for (let i = 0; i < 3; i++) { log.push("read:" + i); const actual = cells[i].value; checkCapture(actual, i === 2 ? 7n : input); }
  log.push("state"); checkCapture(cells[0].value, input); checkCapture(cells[1].value, input); checkCapture(cells[2].value, 7n);
  assert.sameValue(cells.length, 3); assert.sameValue(Object.is(cells[0], cells[1]), false); assert.sameValue(Object.is(cells[1], cells[2]), false);
  assert.compareArray(log, ["initial:0", "initial:1", "initial:2", "write:2", "write:1", "write:0", "read:0", "read:1", "read:2", "outside:1", "read:0", "read:1", "read:2", "state"]);
}
