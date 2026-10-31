/*---
description: Control for accessor-destructure-setter-literal-interface; the accessor calls are explicit.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-objects, ts-destructuring]
---*/
// Control: ../implicit-calls/accessor-destructure-setter-literal-interface.ts; only the implicit accessor operation becomes explicit.
type Value = number;
interface Shape { raw: Value; label: string; x: Value; getX(): Value; setX(value: Value): Value; }
const log: string[] = [];
let effects = 0;
interface Left extends Shape { label: "left"; }
interface Right extends Shape { label: "right"; }
function makeLeft(raw: Value): Left { return {
  raw, label: "left",
  getX(): Value { effects += 1; log.push(`get:${this.label}:${String(this.raw)}:${effects}`); return this.raw; },
  setX(value: Value): Value { effects += 10; log.push(`set:${this.label}:${String(value)}:${effects}`); this.raw = value; return value; },
  get x(): Value { return this.getX(); },
  set x(value: Value) { this.setX(value); },
}; }
function makeRight(raw: Value): Right { return {
  raw, label: "right",
  getX(): Value { effects += 2; log.push(`get:${this.label}:${String(this.raw)}:${effects}`); return this.raw; },
  setX(value: Value): Value { effects += 20; log.push(`set:${this.label}:${String(value)}:${effects}`); this.raw = value; return value; },
  get x(): Value { return this.getX(); },
  set x(value: Value) { this.setX(value); },
}; }
function run(cell: Shape, next: Value): Value {
  cell.setX(next); return next;
}
for (const initial of [-2, 0, 3]) {
  log.length = 0; effects = 0;
  const label = typeof initial === "number" && initial < 0 ? "left" : "right";
  const unit = label === "left" ? 1 : 2;
  const cell = label === "left" ? makeLeft(initial) : makeRight(initial);
  const result = run(cell, initial + 7);
  assert.sameValue(result, initial + 7);
  assert.sameValue(cell.raw, initial + 7);
  assert.sameValue(effects, unit * 10);
  assert.compareArray(log, [`set:${label}:${initial + 7}:${unit * 10}`]);
}
