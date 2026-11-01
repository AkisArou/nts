/*---
description: Control for stringify-class-shared-reference; serialize the same values from a plain literal.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-numbers]
---*/
// Only the declared holder or class construction changes; values, operations and assertions remain identical.
interface JsonSharedLeaf { value: number; }
class JsonSharedRecord {
  left: JsonSharedLeaf;
  right: JsonSharedLeaf;
  constructor(leaf: JsonSharedLeaf) { this.left = leaf; this.right = leaf; }
}
for (const n of [-2, 0, 7]) {
  const leaf: JsonSharedLeaf = { value: n };
  const value = { left: leaf, right: leaf };
  assert.sameValue(value.left, value.right);
  assert.sameValue(JSON.stringify(value), `{"left":{"value":${n}},"right":{"value":${n}}}`);
}
