/*---
description: "Reverse retains the signed bigint kind storage identity and all exact wide values while reversing in place through a static signed bigint-array field. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
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
function localKind(view: LocalView, kind: string): boolean { return view.kind === kind; }
function localBigInt64Array(input: readonly bigint[]): LocalView { return localConstruct(input, 8, "BigInt64Array"); }
function localReverse(view: LocalView): LocalView {
  for (let i = 0; i < view.length / 2; i++) { const a = view.offset + i, b = view.offset + view.length - 1 - i, value = view.elements[a]; view.elements[a] = view.elements[b]; view.elements[b] = value; } return view;
}
// Reverse retains the signed bigint kind storage identity and all exact wide values while reversing in place; route: a static signed bigint-array field. Node prints copies-reverse-bigint-static-field:ok.
type View = LocalView;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = localGet(view, i); return result;
}
class BigBank { static data: View = localBigInt64Array([]); }
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[-9223372036854775808n, 0n, 9223372036854775807n, 1n], [1n, 9223372036854775807n, 0n, -9223372036854775808n]],
  [[7n, -3n, 2n], [2n, -3n, 7n]], [[9n], [9n]],
];
for (const [input, expected] of rows) {
  BigBank.data = localBigInt64Array(input);
  const original: View = BigBank.data, buffer = original.buffer, result: View = localReverse(BigBank.data);
  assert.sameValue(localKind(result, "BigInt64Array"), true); assert.sameValue(result, original);
  assert.sameValue(result.buffer, buffer); assert.compareArray(elements(BigBank.data), expected);
}
console.log("copies-reverse-bigint-static-field:ok");
