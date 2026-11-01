/*---
description: A handwritten memoized copy controls A class returned with nested fields clones to plain data without its method.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-numbers, ts-unions, ts-null-undefined, ts-instanceof, ts-map-set]
---*/
// A Sample return carries own scalar and child data plus a prototype method; node yields two new plain objects and no method.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface Data { value: number | undefined; child: { n: number }; }
class Sample {
  value: number | undefined; child: { n: number };
  constructor(value: number | undefined) { this.value = value; this.child = { n: -0 }; }
  method(): number { return this.child.n; }
}
function input(value: number | undefined): Sample { return new Sample(value); }
function copySample(source: Sample): Data {
  const memory = new Map<object, Data | { n: number }>();
  function copyChild(value: { n: number }): { n: number } {
    const old = memory.get(value); if (old !== undefined && "n" in old) return old;
    const result = { n: value.n }; memory.set(value, result); return result;
  }
  const result: Data = { value: source.value, child: copyChild(source.child) }; memory.set(source, result); return result;
}
for (const n of [-0, NaN, undefined, 7]) {
  const source = input(n), result: Data = copySample(source);
  fresh(result, source, Object.prototype, ["value", "child"]); fresh(result.child, source.child, Object.prototype, ["n"]);
  same(result.value, n); same(result.child.n, -0); same(result instanceof Sample, false); same("method" in result, false);
  result.value = 21; result.child.n = 31; same(source.value, n); same(source.child.n, -0);
  source.value = 22; source.child.n = 32; same(result.value, 21); same(result.child.n, 31); same(source.method(), 32);
}
