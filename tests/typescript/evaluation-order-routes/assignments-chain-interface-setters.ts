/*---
description: "Chained assignment selects both receivers before RHS and passes the untransformed value through both setters."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-assignments, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-interfaces, ts-accessors, ts-objects, ts-this, ts-closures, ts-typeof-operator]
---*/
// An interface route carries a.x = b.x = rhs(); node gets left/right/RHS then sets right/left, while the right setter retargets the outer receiver and stores a different value.
const log: string[] = [];
interface Cell { raw: number; x: number; }
interface Route { left: Cell; right: Cell; }
for (const value of [-3, 0, 8]) {
  const other: Cell = { raw: 90, x: 90 };
  const left: Cell = { raw: 0, get x(): number { log.push("get:left"); return this.raw; }, set x(next: number) { log.push(`set:left:${next}`); this.raw = next + 10; } };
  let active: Cell = left;
  const right: Cell = { raw: 0, get x(): number { log.push("get:right"); return this.raw; }, set x(next: number) { log.push(`set:right:${next}`); this.raw = next * 2; left.raw = 77; active = other; } };
  const route: Route = { get left(): Cell { log.push("left"); return active; }, get right(): Cell { log.push("right"); return right; } };
  function rhs(): number { log.push("rhs"); left.raw = 100; right.raw = 200; return value; }
  function run(): number { log.push("run"); return route.left.x = route.right.x = rhs(); }
  log.length = 0; const result = run();
  assert.compareArray(log, ["run", "left", "right", "rhs", `set:right:${value}`, `set:left:${value}`]);
  assert.sameValue(result, value); assert.sameValue(typeof result, "number");
  assert.sameValue(left.raw, value + 10); assert.sameValue(right.raw, value * 2); assert.sameValue(other.raw, 90); assert.sameValue(other.x, 90); assert.sameValue(active, other);
}
