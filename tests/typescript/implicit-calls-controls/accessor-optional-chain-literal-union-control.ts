/*---
description: Control for accessor-optional-chain-literal-union; the accessor calls are explicit.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-objects, ts-unions, ts-discriminated-unions, ts-null-undefined, ts-optional-chaining]
---*/
// Control: ../implicit-calls/accessor-optional-chain-literal-union.ts; only the implicit accessor operation becomes explicit.
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
function run(cell: Left | Right | undefined): Value | undefined {
  return cell?.getX();
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
