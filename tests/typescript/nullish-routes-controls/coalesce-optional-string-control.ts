/*---
description: "Coalescing keeps an empty optional string. Route: optional interface property (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-interfaces, ts-optional-properties]
---*/

// Coalescing keeps an empty optional string. Route: optional interface property. Node prints coalesce-optional-string:ok.
interface Option { label?: string | null }
function select(option: Option): string {
  const saved = option.label; const result = saved === null || saved === undefined ? "missing" : saved;
  return result;
}
const rows: readonly (readonly [Option, string])[] = [[{}, "missing"], [{ label: undefined }, "missing"], [{ label: null }, "missing"], [{ label: "" }, ""], [{ label: "a" }, "a"]];
for (const [option, expected] of rows) assert.sameValue(select(option), expected);
console.log("coalesce-optional-string:ok");
