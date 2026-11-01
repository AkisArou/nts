/*---
description: "Control for builtins-promise-then-species; hold the builtin beside explicit kind and data fields."
features: [ts-layout-routes, ts-layout-route-builtins, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-properties, ts-async, ts-arrow-functions]
flags: [async]
---*/
// Plain records hold native promises; explicitly wrap then results with the same kind and freshly initialized ordinary fields.
type BuiltinPoint = { id: number };
type BuiltinValue = number | string | bigint | boolean | null | undefined | BuiltinPoint;
type BuiltinRow = { value: BuiltinValue; num: number; text: string; ref: BuiltinPoint };
const refs: BuiltinPoint[] = [{ id: 7 }, { id: 11 }, { id: 13 }];
const payloads: BuiltinValue[] = [-0, NaN, 0n, "", undefined, null, false, refs[0]];
function rowFor(value: BuiltinValue, index: number): BuiltinRow { return { value, num: [-0, NaN, 2.5][index % 3], text: ["", "one", "two"][index % 3], ref: refs[index % 3] }; }
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type LayoutFuture = { kind: number; value: Promise<BuiltinValue>; marker: BuiltinPoint; num?: number; label?: string };
function make(kind: number, value: Promise<BuiltinValue>): LayoutFuture {
  if (kind === 1) return { kind, value, marker: refs[0], num: -0 };
  if (kind === 2) return { kind, value, marker: refs[0], label: "" }; return { kind, value, marker: refs[0] };
}
function inspect(value: LayoutFuture, kind: number, marker: BuiltinPoint): void {
  if (!(value.kind >= 0 && value.kind <= 2)) throw new Error("lost layout");
  same(value.marker, marker); same("marker" in value, true); same(value.kind >= 0 && value.kind <= 2, true); same(value.kind >= 0 && value.kind <= 2, true);
  same(value.kind === 1, kind === 1); same(value.kind === 2, kind === 2); same("num" in value, kind === 1); same("label" in value, kind === 2);
  if (value.kind === 1) same(value.num, -0); if (value.kind === 2) same(value.label, "");
}
async function run(): Promise<void> {
  for (let index = 0; index < payloads.length; index++) for (let kind = 0; kind < 3; kind++) {
    const row = rowFor(payloads[index], index), original = make(kind, new Promise<BuiltinValue>(resolve => resolve(row.value))); original.marker = row.ref;
    const view: Promise<BuiltinValue> = original.value; inspect(original, kind, row.ref); let calls = 0;
    const result = make(kind, view.then(value => { same(value, row.value); calls++; return value; }));
    same(await result.value, row.value); same(calls, 1); same(await original.value, row.value); same(Object.is(result, original), false); same(Object.is(result.value, original.value), false);
    inspect(result, kind, refs[0]); same(original.marker, row.ref); same(view, original.value);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
