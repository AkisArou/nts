/*---
description: "Promise base views preserve fulfillment values and three subclass result layouts."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-builtin-subclass, ts-async, ts-arrow-functions]
flags: [async]
---*/
// Three Promise layouts cross Promise<BuiltinValue>; then keeps fulfillment identity and returns the corresponding subclass with fresh own fields.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class LayoutFuture extends Promise<BuiltinValue> { marker: BuiltinPoint = refs[0]; }
class NumberFuture extends LayoutFuture { num: number = -0; }
class TextFuture extends LayoutFuture { label: string = ""; }
function inspect(value: Promise<BuiltinValue>, kind: number, marker: BuiltinPoint): void {
  if (!(value instanceof LayoutFuture)) throw new Error("lost layout");
  same(value.marker, marker); same("marker" in value, true); same(value instanceof Promise, true); same(value instanceof LayoutFuture, true);
  same(value instanceof NumberFuture, kind === 1); same(value instanceof TextFuture, kind === 2); same("num" in value, kind === 1); same("label" in value, kind === 2);
  if (value instanceof NumberFuture) same(value.num, -0); if (value instanceof TextFuture) same(value.label, "");
}
async function run(): Promise<void> {
  const types: (typeof LayoutFuture)[] = [LayoutFuture, NumberFuture, TextFuture];
  for (let index = 0; index < payloads.length; index++) for (let kind = 0; kind < types.length; kind++) {
    const row = rowFor(payloads[index], index), Type = types[kind], original = new Type(resolve => resolve(row.value)); original.marker = row.ref;
    const view: Promise<BuiltinValue> = original; inspect(view, kind, row.ref); let calls = 0;
    const result = view.then(value => { same(value, row.value); calls++; return value; });
    same(await result, row.value); same(calls, 1); same(await original, row.value); same(Object.is(result, original), false);
    if (!(result instanceof LayoutFuture)) throw new Error("lost promise species"); inspect(result, kind, refs[0]); same(original.marker, row.ref); same(view, original);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
