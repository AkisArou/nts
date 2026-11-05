/*---
description: "A discriminated numeric branch keeps signed zero under coalescing. Route: discriminant-narrowed union (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-unions, ts-narrowing]
---*/

// A discriminated numeric branch keeps signed zero under coalescing. Route: discriminant-narrowed union. Node prints coalesce-narrowed-union:ok.
type Choice = { kind: "number"; value: number | null } | { kind: "text"; value: string | null };
function read(choice: Choice): number | string {
  if (choice.kind === "number") {
    const saved = choice.value; const result = saved === null || saved === undefined ? 9 : saved;
    return result;
  }
  const saved = choice.value;
  return saved === null || saved === undefined ? "default" : saved;
}
assert.sameValue(read({ kind: "number", value: -0 }), -0);
assert.sameValue(read({ kind: "number", value: null }), 9);
assert.sameValue(read({ kind: "text", value: "" }), "");
console.log("coalesce-narrowed-union:ok");
