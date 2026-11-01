/*---
description: A handwritten memoized copy controls A class prototype getter is omitted without executing during cloning.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-accessors, ts-interfaces, ts-numbers, ts-instanceof, ts-map-set]
---*/
// A Meter interface implementation carries a prototype getter; node copies the own value and never executes or retains that getter.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
interface MeterData { value: number; }
class Meter implements MeterData {
  static reads: number = 0; value: number;
  constructor(n: number) { this.value = n; }
  get doubled(): number { Meter.reads++; return this.value * 2; }
}
function copyMeter(source: MeterData, memory = new Map<MeterData, MeterData>()): MeterData {
  const old = memory.get(source); if (old !== undefined) return old;
  const result = { value: source.value }; memory.set(source, result); return result;
}
for (const n of [-0, NaN, 7]) {
  Meter.reads = 0; const source: MeterData = new Meter(n), result = copyMeter(source);
  same(Meter.reads, 0); fresh(result, source, Object.prototype, ["value"]); same(result.value, n);
  same(result instanceof Meter, false); same("doubled" in result, false);
  result.value = 21; same(source.value, n); source.value = 32; same(result.value, 21); same(Meter.reads, 0);
  if (!(source instanceof Meter)) throw new Error("source"); same(source.doubled, 64); same(Meter.reads, 1);
}
