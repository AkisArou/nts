/*---
description: Two class fields retaining the same noncyclic object serialize that object twice rather than reporting a cycle.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-objects, ts-numbers]
---*/
// Serialize shared references stored in declared class fields; node emits both branches because the graph has no cycle.
interface JsonSharedLeaf { value: number; }
class JsonSharedRecord {
  left: JsonSharedLeaf;
  right: JsonSharedLeaf;
  constructor(leaf: JsonSharedLeaf) { this.left = leaf; this.right = leaf; }
}
for (const n of [-2, 0, 7]) {
  const leaf: JsonSharedLeaf = { value: n };
  const value: JsonSharedRecord = new JsonSharedRecord(leaf);
  assert.sameValue(value.left, value.right);
  assert.sameValue(JSON.stringify(value), `{"left":{"value":${n}},"right":{"value":${n}}}`);
}
