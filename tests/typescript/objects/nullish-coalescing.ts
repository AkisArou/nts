/*---
description: `??` replaces only null and undefined, where `||` also replaces 0, "" and false.
features: [ts-objects, ts-null-undefined]
---*/
type Input = { count?: number | null; label?: string };
function read(input: Input): string {
  return `${input.count ?? -1}/${input.count || -1}/${input.label ?? "none"}/${input.label || "none"}`;
}
assert.sameValue(read({ count: 0, label: "" }), "0/-1//none");
assert.sameValue(read({ count: null }), "-1/-1/none/none");
assert.sameValue(read({ count: 5, label: "x" }), "5/5/x/x");
