/*---
description: "Coalescing over zero skips a throwing fallback. Route: class field and throwing function"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-class, ts-errors]
---*/

// Coalescing over zero skips a throwing fallback. Route: class field and throwing function. Node prints coalesce-rhs-throw-skip:ok.
class Cell { value: number | null = 0; }
const log: string[] = [];
function fail(): number { log.push("fail"); throw new Error("not reached"); }
function read(cell: Cell): number {
  const result = cell.value ?? fail();
  return result;
}
assert.sameValue(read(new Cell()), 0);
assert.compareArray(log, []);
console.log("coalesce-rhs-throw-skip:ok");
