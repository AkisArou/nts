/*---
description: Control for accessor-destructure-default-class-interface; the accessor calls are explicit.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-class, ts-class-fields, ts-null-undefined, ts-destructuring]
---*/
// Control: ../implicit-calls/accessor-destructure-default-class-interface.ts; only the implicit accessor operation becomes explicit.
type Value = number | null | undefined;
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
function fallback(): number { effects += 100; log.push(`default:${effects}`); return 7; }
function run(cell: Shape): Value {
  const x = cell.getX(); return x === undefined ? fallback() : x;
}
const inputs: Value[] = [undefined, null, -2, 0, 3];
for (const initial of inputs) {
  log.length = 0; effects = 0;
  const label = typeof initial === "number" && initial < 0 ? "left" : "right";
  const unit = label === "left" ? 1 : 2;
  const cell = label === "left" ? new Left(initial) : new Right(initial);
  const result = run(cell);
  assert.sameValue(result, initial === undefined ? 7 : initial);
  assert.sameValue(cell.raw, initial);
  assert.sameValue(effects, initial === undefined ? 100 + unit : unit);
  const expected = [`get:${label}:${String(initial)}:${unit}`];
  if (initial === undefined) expected.push(`default:${100 + unit}`);
  assert.compareArray(log, expected);
}
