/*---
description: A handwritten memoized copy controls A recursive class graph becomes plain objects while preserving shared children and cycles.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-numbers, ts-optional-properties, ts-instanceof, ts-null-undefined, ts-map-set]
---*/
// A Link variable carries absent children, shared children and back edges; node removes each class prototype while preserving the graph.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface LinkData { value: number; left?: LinkData; right?: LinkData; }
class Link {
  value: number; left?: Link; right?: Link;
  constructor(n: number) { this.value = n; }
  method(): number { return this.value; }
}
function copyLink(source: Link, memory = new Map<Link, LinkData>()): LinkData {
  const old = memory.get(source); if (old !== undefined) return old;
  const result: LinkData = { value: source.value, left: undefined, right: undefined }; memory.set(source, result);
  if (source.left !== undefined) result.left = copyLink(source.left, memory);
  if (source.right !== undefined) result.right = copyLink(source.right, memory); return result;
}
for (const n of [-0, NaN, 7]) for (const shape of [0, 1, 2]) {
  const source: Link = new Link(n), child = new Link(-0);
  if (shape === 1) { source.left = child; source.right = child; }
  if (shape === 2) { source.left = source; source.right = child; child.left = source; child.right = child; }
  const result = copyLink(source); fresh(result, source, Object.prototype, ["value", "left", "right"]);
  same(result.value, n); same(result instanceof Link, false); same("method" in result, false);
  if (shape === 0) { same(result.left, undefined); same(result.right, undefined); }
  else {
    const copied = result.right; if (copied === undefined) throw new Error("child");
    fresh(copied, child, Object.prototype, ["value", "left", "right"]); same(Object.is(copied, result), false); same(copied.value, -0); same(copied instanceof Link, false); same("method" in copied, false);
    same(result.left, shape === 1 ? copied : result); same(copied.left, shape === 1 ? undefined : result); same(copied.right, shape === 1 ? undefined : copied);
    copied.value = 21; same(child.value, -0); child.value = 32; same(copied.value, 21);
  }
  result.value = 9; same(source.value, n); source.value = 11; same(result.value, 9);
}
