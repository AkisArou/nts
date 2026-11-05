/*---
description: "With copies unsigned 64 bit values at start middle and negative indexes while rejected indexes leave the source intact through readonly replacement tuples. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions, ts-errors]
---*/

type LocalView = { elements: bigint[]; offset: number; length: number; buffer: bigint[]; byteOffset: number; byteLength: number; kind: string; unit: number };
function localView(elements: bigint[], offset: number, length: number, unit: number, kind: string): LocalView {
  return { elements, offset, length, buffer: elements, byteOffset: offset * unit, byteLength: length * unit, unit, kind };
}
function localEncode(value: bigint, kind: string): bigint { const n = ((value % 18446744073709551616n) + 18446744073709551616n) % 18446744073709551616n; return kind === "BigInt64Array" && n >= 9223372036854775808n ? n - 18446744073709551616n : n; }
function localConstruct(input: readonly bigint[], unit: number, kind: string): LocalView {
  const out: bigint[] = []; for (let i = 0; i < input.length; i++) out[i] = localEncode(input[i], kind); return localView(out, 0, out.length, unit, kind);
}
function localGet(view: LocalView, index: number): bigint { return view.elements[view.offset + index]; }
function localWriteIndex(view: LocalView, index: number, value: bigint): void { if (index >= 0 && index < view.length && index % 1 === 0) view.elements[view.offset + index] = localEncode(value, view.kind); }
function localKind(view: LocalView, kind: string): boolean { return view.kind === kind; }
function localBigUint64Array(input: readonly bigint[]): LocalView { return localConstruct(input, 8, "BigUint64Array"); }
function localWith(view: LocalView, index: number, value: bigint): LocalView {
  let at = index !== index ? 0 : index - index % 1; if (at < 0) at += view.length;
  if (at < 0 || at >= view.length || at !== at) throw new RangeError();
  const out: bigint[] = []; for (let i = 0; i < view.length; i++) out[i] = i === at ? localEncode(value, view.kind) : view.elements[view.offset + i]; return localView(out, 0, out.length, view.unit, view.kind);
}
// With copies unsigned 64 bit values at start middle and negative indexes while rejected indexes leave the source intact; route: readonly replacement tuples. Node prints copies-with-biguint-readonly-indices:ok.
type View = LocalView;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
const source: View = localBigUint64Array([0n, 9223372036854775808n, 18446744073709551615n]);
const rows: readonly [number, bigint, readonly bigint[]][] = [
  [0, 7n, [7n, 9223372036854775808n, 18446744073709551615n]], [-1, 3n, [0n, 9223372036854775808n, 3n]],
  [1, 18446744073709551615n, [0n, 18446744073709551615n, 18446744073709551615n]],
];
for (const [index, value, expected] of rows) {
  const result: View = localWith(source, index, value);
  assert.sameValue(localKind(result, "BigUint64Array"), true); assert.sameValue(result.buffer === source.buffer, false);
  assert.compareArray(elements(result), expected);
  localWriteIndex(result, 0, 9n); assert.compareArray(elements(source), [0n, 9223372036854775808n, 18446744073709551615n]);
}
for (const index of [-4, 3]) assert.throws(RangeError, () => localWith(source, index, 0n));
assert.compareArray(elements(source), [0n, 9223372036854775808n, 18446744073709551615n]);
console.log("copies-with-biguint-readonly-indices:ok");
