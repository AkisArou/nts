/*---
description: "A generic return preserves the concrete subclass from an inherited polymorphic this method."
features: [ts-type-form-routes, ts-type-form-route-values, ts-this-type, ts-class, ts-class-fields, ts-inheritance, ts-this, ts-generics, ts-generic-constraints, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// Polymorphic this returns through revise<T> before subclass tagging and another inherited call; node keeps the same object and every payload kind.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
class PayloadCell {
  value: unknown = undefined;
  put(value: unknown): this { log.push("put", this, value); this.value = value; return this; }
}
class MarkedCell extends PayloadCell {
  mark: string = "";
  tag(mark: string): this { log.push("tag", this, mark); this.mark = mark; return this; }
}
function revise<T extends PayloadCell>(cell: T, value: unknown): T { return cell.put(value); }
const values: unknown[] = [undefined, false, -0, NaN, "", 0n, { id: 7 }];
for (const value of values) {
  const original = new MarkedCell(); log.length = 0;
  const result = revise(original, value).tag("child").put(value);
  same(result, original); same(typeof result, "object"); same(result.value, value); same(result.mark, "child");
  exact(log, ["put", original, value, "tag", original, "child", "put", original, value]);
}
