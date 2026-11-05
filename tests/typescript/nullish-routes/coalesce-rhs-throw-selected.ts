/*---
description: "Coalescing over null evaluates a throwing fallback once. Route: interface field and throwing function"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-interfaces, ts-throws]
---*/

// Coalescing over null evaluates a throwing fallback once. Route: interface field and throwing function. Node prints coalesce-rhs-throw-selected:ok.
interface Cell { value: number | null }
const log: string[] = [];
function fail(): number { log.push("fail"); throw new Error("chosen"); }
function read(cell: Cell): number {
  const result = cell.value ?? fail();
  return result;
}
assert.throws(Error, () => { read({ value: null }); });
assert.compareArray(log, ["fail"]);
console.log("coalesce-rhs-throw-selected:ok");
