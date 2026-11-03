/*---
description: "Control for values-alias-object-field; A namespace value alias retains an object through an interface field after the namespace property is replaced."
features: [ts-type-form-routes, ts-type-form-route-values, ts-namespace, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// import saved = Store.current crosses Holder.item; node retains the captured object, shares its writes and keeps later namespace replacements separate. The control uses a const initialized from the same namespace property.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface Box { value: unknown; }
namespace Store { export let current: Box = { value: undefined }; }
const saved = Store.current;
interface Holder { item: Box; }
const original = saved, holder: Holder = { item: saved };
const values: unknown[] = [undefined, false, -0, NaN, "", 0n, { id: 7 }];
for (const value of values) {
  holder.item.value = value;
  const replacement: Box = { value: "new" }; Store.current = replacement;
  same(holder.item, original); same(saved, original); same(typeof saved, "object");
  same(saved.value, value); same(holder.item.value, value); same(Store.current, replacement); same(Store.current.value, "new");
  same(saved === Store.current, false);
}
