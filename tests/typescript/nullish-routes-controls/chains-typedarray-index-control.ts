/*---
description: "An optional typed-array element read distinguishes absence from a stored zero. Route: nullable Uint8Array field (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// An optional typed-array element read distinguishes absence from a stored zero. Route: nullable Uint8Array field. Node prints chains-typedarray-index:ok.
class Bytes { data: Uint8Array | null; constructor(data: Uint8Array | null) { this.data = data; } }
function first(bytes: Bytes): number | undefined {
  const saved = bytes.data; const result = saved === null || saved === undefined ? undefined : saved[0];
  return result;
}
assert.sameValue(first(new Bytes(null)), undefined);
assert.sameValue(first(new Bytes(new Uint8Array([0]))), 0);
assert.sameValue(first(new Bytes(new Uint8Array([255]))), 255);
console.log("chains-typedarray-index:ok");
