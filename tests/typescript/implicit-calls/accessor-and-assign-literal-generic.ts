/*---
description: Logical-and assignment reaches literal accessors through a generic view and preserves each call and effect.
features: [ts-implicit-accessor, ts-accessors, ts-interfaces, ts-functions, ts-objects, ts-generics, ts-generic-constraints, ts-null-undefined]
---*/
// Route: logical-and assignment -> literal accessors through generic; node preserves exact get/set calls, state and result.
type Value = number | null | undefined;
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
function run<T extends Shape>(cell: T, next: Value): Value {
  return cell.x &&= next;
}
const inputs: Value[] = [undefined, null, -2, 0, 3];
for (const initial of inputs) {
  log.length = 0; effects = 0;
  const label = typeof initial === "number" && initial < 0 ? "left" : "right";
  const unit = label === "left" ? 1 : 2;
  const cell = label === "left" ? makeLeft(initial) : makeRight(initial);
  const result = run(cell, 7);
  const writes = Boolean(initial);
  assert.sameValue(result, writes ? 7 : initial);
  assert.sameValue(cell.raw, writes ? 7 : initial);
  assert.sameValue(effects, unit * (writes ? 11 : 1));
  const expected = [`get:${label}:${String(initial)}:${unit}`];
  if (writes) expected.push(`set:${label}:7:${unit * 11}`);
  assert.compareArray(log, expected);
}
