/*---
description: Optional property access reaches literal accessors through a generic view and preserves each call and effect.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-objects, ts-generics, ts-generic-constraints, ts-null-undefined, ts-optional-chaining]
---*/
// Route: optional property access -> literal accessors through generic; node preserves exact get/set calls, state and result.
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
function run<T extends Shape>(cell: T | undefined): Value | undefined {
  return cell?.x;
}
for (const initial of [-2, 0, 3]) {
  log.length = 0; effects = 0;
  const label = typeof initial === "number" && initial < 0 ? "left" : "right";
  const unit = label === "left" ? 1 : 2;
  const cell = label === "left" ? makeLeft(initial) : makeRight(initial);
  const result = run(initial === 0 ? undefined : cell);
  assert.sameValue(result, initial === 0 ? undefined : initial);
  assert.sameValue(cell.raw, initial);
  assert.sameValue(effects, initial === 0 ? 0 : unit);
  assert.compareArray(log, initial === 0 ? [] : [`get:${label}:${String(initial)}:${unit}`]);
}
