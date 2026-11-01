/*---
description: "Control for statics-freeze-shallow-generic-alias; Generic freeze keeps its returned alias shallow while strict replacement of the child field fails."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-generics, ts-readonly, ts-optional-properties, ts-errors, ts-arrow-functions, ts-closures]
---*/
// ShallowOuter crosses a generic object-to-Readonly route with optional own undefined; node freezes only the outer object, preserves child identity and permits a later child-value write. The control writes the operation explicitly.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type StaticChild = { value: StaticValue };
type ShallowOuter = { child: StaticChild; maybe?: StaticValue };
function solidify<T extends object>(value: T): Readonly<T> { return value; }
function inspect(input: StaticValue, present: boolean): void {
  const log: unknown[] = [], child: StaticChild = { value: input }, other: StaticChild = { value: replacement };
  const source: ShallowOuter = { child }; if (present) source.maybe = undefined;
  const alias: ShallowOuter = source, frozen = solidify(source);
  const outerFrozen = true, childFrozen = false; log.push("integrity", outerFrozen, childFrozen);
  same(frozen, source); same(outerFrozen, true); same(childFrozen, false);
  assert.throws(TypeError, () => { log.push("replace.child", child, other); throw new TypeError("frozen child field"); });
  child.value = replacement; log.push("child.write", child.value);
  const keys = present ? ["child", "maybe"] : ["child"], walked: string[] = [];
  for (const key in frozen) walked.push(key);
  assert.compareArray(Object.keys(frozen), keys); assert.compareArray(walked, keys); same(Object.hasOwn(frozen, "maybe"), present);
  same(frozen.child, child); same(alias.child, child); same(frozen.child.value, replacement); same(frozen.maybe, undefined);
  assert.compareArray(log, ["integrity", true, false, "replace.child", child, other, "child.write", replacement]);
}
for (const input of inputs) for (const present of [false, true]) inspect(input, present);
