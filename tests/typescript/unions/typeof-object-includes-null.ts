/*---
description: `typeof value === "object"` admits null, and the narrowed type says so.
features: [ts-unions, ts-narrowing, ts-null-undefined]
---*/
function kind(value: { id: number } | null | string): string {
  if (typeof value === "object") {
    return value === null ? "null" : `object ${value.id}`;
  }
  return `string ${value}`;
}
assert.sameValue(kind(null), "null");
assert.sameValue(kind({ id: 3 }), "object 3");
assert.sameValue(kind("s"), "string s");
