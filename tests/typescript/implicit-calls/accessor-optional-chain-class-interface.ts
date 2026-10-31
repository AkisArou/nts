/*---
description: Optional property access reaches class accessors through a interface view and preserves each call and effect.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-class, ts-class-fields, ts-null-undefined, ts-optional-chaining]
---*/
// Route: optional property access -> class accessors through interface; node preserves exact get/set calls, state and result.
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
function run(cell: Shape | undefined): Value | undefined {
  return cell?.x;
}
for (const initial of [-2, 0, 3]) {
  log.length = 0; effects = 0;
  const label = typeof initial === "number" && initial < 0 ? "left" : "right";
  const unit = label === "left" ? 1 : 2;
  const cell = label === "left" ? new Left(initial) : new Right(initial);
  const result = run(initial === 0 ? undefined : cell);
  assert.sameValue(result, initial === 0 ? undefined : initial);
  assert.sameValue(cell.raw, initial);
  assert.sameValue(effects, initial === 0 ? 0 : unit);
  assert.compareArray(log, initial === 0 ? [] : [`get:${label}:${String(initial)}:${unit}`]);
}
