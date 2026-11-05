/*---
description: "Coalescing over null evaluates a throwing fallback once. Route: interface field and throwing function (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-interfaces, ts-throws]
---*/

// Coalescing over null evaluates a throwing fallback once. Route: interface field and throwing function. Node prints coalesce-rhs-throw-selected:ok.
interface Cell { value: number | null }
const log: string[] = [];
function fail(): number { log.push("fail"); throw new Error("chosen"); }
function read(cell: Cell): number {
  const saved = cell.value; const result = saved === null || saved === undefined ? fail() : saved;
  return result;
}
assert.throws(Error, () => { read({ value: null }); });
assert.compareArray(log, ["fail"]);
console.log("coalesce-rhs-throw-selected:ok");
