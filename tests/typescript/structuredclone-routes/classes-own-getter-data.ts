/*---
description: An own enumerable class getter runs once and becomes a writable data property.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-accessors, ts-interfaces, ts-numbers, ts-closures, ts-function-types, ts-arrow-functions, ts-instanceof]
---*/
// An AccessorBox parameter carries an own enumerable accessor; node invokes it once and stores its value in a fresh plain data property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface AccessorData { value: number; }
class AccessorBox {
  value: number = 0;
  constructor(read: () => number, write: (n: number) => void) { Object.defineProperty(this, "value", { enumerable: true, configurable: true, get: read, set: write }); }
  method(): number { return 1; }
}
function copyBox(source: AccessorBox): AccessorData { return structuredClone(source); }
for (const n of [-0, NaN, 7]) {
  let stored = n, reads = 0;
  const source: AccessorBox = new AccessorBox(() => { reads++; return stored; }, value => { stored = value; });
  const result = copyBox(source); same(reads, 1); fresh(result, source, Object.prototype, ["value"]);
  same(result instanceof AccessorBox, false); same("method" in result, false); same(result.value, n); same(reads, 1);
  const descriptor = Object.getOwnPropertyDescriptor(result, "value"); if (descriptor === undefined) throw new Error("property");
  same(descriptor.get, undefined); same(descriptor.set, undefined); same(descriptor.value, n); same(descriptor.writable, true);
  result.value = 21; same(stored, n); same(reads, 1); source.value = 32; same(result.value, 21); same(source.value, 32); same(reads, 2);
}
