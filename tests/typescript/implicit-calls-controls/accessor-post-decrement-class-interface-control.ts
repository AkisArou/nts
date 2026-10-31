/*---
description: Control for accessor-post-decrement-class-interface; the accessor calls are explicit.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-class, ts-class-fields]
---*/
// Control: ../implicit-calls/accessor-post-decrement-class-interface.ts; only the implicit accessor operation becomes explicit.
type Value = number;
interface Shape { raw: Value; label: string; x: Value; getX(): Value; setX(value: Value): Value; }
const log: string[] = [];
let effects = 0;
class Left implements Shape {
  raw: Value; label: "left" = "left";
  constructor(raw: Value) { this.raw = raw; }
  getX(): Value { effects += 1; log.push(`get:${this.label}:${String(this.raw)}:${effects}`); return this.raw; }
  setX(value: Value): Value { effects += 10; log.push(`set:${this.label}:${String(value)}:${effects}`); this.raw = value; return value; }
  get x(): Value { return this.getX(); }
  set x(value: Value) { this.setX(value); }
}
class Right implements Shape {
  raw: Value; label: "right" = "right";
  constructor(raw: Value) { this.raw = raw; }
  getX(): Value { effects += 2; log.push(`get:${this.label}:${String(this.raw)}:${effects}`); return this.raw; }
  setX(value: Value): Value { effects += 20; log.push(`set:${this.label}:${String(value)}:${effects}`); this.raw = value; return value; }
  get x(): Value { return this.getX(); }
  set x(value: Value) { this.setX(value); }
}
function run(cell: Shape): Value {
  const old = cell.getX(); cell.setX(old - 1); return old;
}
for (const initial of [-2, 0, 3]) {
  log.length = 0; effects = 0;
  const label = typeof initial === "number" && initial < 0 ? "left" : "right";
  const unit = label === "left" ? 1 : 2;
  const cell = label === "left" ? new Left(initial) : new Right(initial);
  const result = run(cell);
  assert.sameValue(result, initial);
  assert.sameValue(cell.raw, initial - 1);
  assert.sameValue(effects, unit * 11);
  assert.compareArray(log, [`get:${label}:${String(initial)}:${unit}`, `set:${label}:${initial - 1}:${unit * 11}`]);
}
