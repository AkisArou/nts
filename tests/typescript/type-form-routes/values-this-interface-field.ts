/*---
description: "A polymorphic this chain through an interface field retains subclass identity, payload and ordered calls."
features: [ts-type-form-routes, ts-type-form-route-values, ts-this-type, ts-class, ts-class-fields, ts-inheritance, ts-this, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// Polymorphic this crosses Holder.item into inherited put/name/put calls; node returns the original NamedCell with exact payload and label.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
class ValueCell {
  value: number = 0;
  put(value: number): this { log.push("put", this, value); this.value = value; return this; }
}
class NamedCell extends ValueCell {
  label: string = "";
  name(label: string): this { log.push("name", this, label); this.label = label; return this; }
}
interface Holder { item: NamedCell; }
for (const value of [-0, 0, 2.5, NaN]) {
  const original = new NamedCell(), holder: Holder = { item: original }; log.length = 0;
  const result = holder.item.put(value).name("kept").put(value);
  same(result, original); same(typeof result, "object"); same(result.value, value); same(result.label, "kept");
  same(holder.item, original); same(original.value, value);
  exact(log, ["put", original, value, "name", original, "kept", "put", original, value]);
}
