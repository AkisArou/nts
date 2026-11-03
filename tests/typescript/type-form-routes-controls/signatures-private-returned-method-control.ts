/*---
description: A TypeScript-private method read by a literal key on a returned receiver preserves the receiver, argument and body order. The control uses a public method with the same typed returned receiver and call.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-typeof-operator]
---*/
// The typed receiver return exposes private add through a literal key; node keeps receiver/argument/body order and returns 2, negative zero and 1.75. The control uses a public method with the same typed returned receiver and call.
const log: string[] = [];
class Cell {
  value: number;
  constructor(value: number) { this.value = value; }
  public add(delta: number): number { log.push("body"); this.value += delta; return this.value; }
}
function receiver(cell: Cell): Cell { log.push("receiver"); return cell; }
function argument(value: number): number { log.push("argument"); return value; }
const entries: [number, number, number][] = [[0, 2, 2], [-0, -0, -0], [1.5, 0.25, 1.75]];
for (const [initial, delta, expected] of entries) {
  log.length = 0;
  const cell = new Cell(initial), result = receiver(cell)["add"](argument(delta));
  assert.sameValue(result, expected); assert.sameValue(typeof result, "number");
  assert.sameValue(cell.value, expected); assert.sameValue(typeof cell.value, "number");
  assert.sameValue(typeof cell["add"], "function");
  assert.compareArray(log, ["receiver", "argument", "body"]);
}
