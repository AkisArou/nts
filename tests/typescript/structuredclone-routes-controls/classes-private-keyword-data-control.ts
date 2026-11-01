/*---
description: A handwritten memoized copy controls A TypeScript private property remains ordinary own data in a plain clone.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-private-keyword, ts-numbers, ts-strings, ts-instanceof, ts-map-set]
---*/
// A SecretBox variable carries a TypeScript-private property; node retains that ordinary own field while removing the class methods.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
class SecretBox {
  private hidden: number; label: string;
  constructor(n: number) { this.hidden = n; this.label = "data"; }
  read(): number { return this.hidden; }
  write(n: number): void { this.hidden = n; }
}
function copyBox(source: SecretBox, memory = new Map<SecretBox, object>()): object {
  const old = memory.get(source); if (old !== undefined) return old;
  const fields: object = source; if (!("hidden" in fields) || typeof fields.hidden !== "number") throw new Error("data");
  const result = { hidden: fields.hidden, label: source.label }; memory.set(source, result); return result;
}
for (const n of [-0, NaN, 7]) {
  const source: SecretBox = new SecretBox(n), result: object = copyBox(source);
  fresh(result, source, Object.prototype, ["hidden", "label"]); same(result instanceof SecretBox, false);
  same("read" in result, false); same("write" in result, false);
  if (!("hidden" in result) || typeof result.hidden !== "number" || !("label" in result)) throw new Error("data");
  same(result.hidden, n); same(result.label, "data");
  result.hidden = 21; same(source.read(), n); source.write(32); same(result.hidden, 21);
  result.label = "copied"; same(source.label, "data"); source.label = "original"; same(result.label, "copied");
}
