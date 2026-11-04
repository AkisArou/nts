/*---
description: "Simple assignment retains an interface receiver and returns the RHS before a transforming setter stores it."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-class, ts-class-fields, ts-accessors, ts-objects, ts-this, ts-closures, ts-typeof-operator]
---*/
// Interface accessors carry a simple assignment; node logs target, RHS, then one original setter and returns the untransformed number.
const log: string[] = [];
interface Cell { label: string; raw: number; x: number; }
class Left implements Cell {
  label: string = "left"; raw: number = 0;
  get x(): number { log.push("get:left"); return this.raw; }
  set x(value: number) { log.push(`set:left:${value}`); this.raw = value + 10; }
}
class Right implements Cell {
  label: string = "right"; raw: number = 0;
  get x(): number { log.push("get:right"); return this.raw; }
  set x(value: number) { log.push(`set:right:${value}`); this.raw = value * 2; }
}
for (const value of [-3, 0, 8]) {
  const literal: Cell = { label: "literal", raw: 0, get x(): number { log.push("get:literal"); return this.raw; }, set x(next: number) { log.push(`set:literal:${next}`); this.raw = -next; } };
  const cells: Cell[] = [new Left(), new Right(), literal];
  for (const cell of cells) {
    const other: Cell = { label: "other", raw: 90, x: 90 }; let active: Cell = cell;
    function target(): Cell { log.push(`target:${active.label}`); return active; }
    function rhs(): number { log.push(`rhs:${active.label}`); cell.raw = 99; active = other; return value; }
    function run(): number { log.push("run"); return target().x = rhs(); }
    log.length = 0; const result = run();
    assert.compareArray(log, ["run", `target:${cell.label}`, `rhs:${cell.label}`, `set:${cell.label}:${value}`]);
    assert.sameValue(result, value); assert.sameValue(typeof result, "number");
    assert.sameValue(cell.raw, cell.label === "left" ? value + 10 : cell.label === "right" ? value * 2 : -value);
    assert.sameValue(active, other); assert.sameValue(other.x, 90); assert.sameValue(other.raw, 90);
  }
}
