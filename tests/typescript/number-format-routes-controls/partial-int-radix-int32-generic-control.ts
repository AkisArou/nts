/*---
description: "Table control for partial-int-radix-int32-generic; A constrained generic record supplies raw fractional, nonfinite and wrapped radices to parseInt."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints]
---*/
// Two generic record shapes carry the same raw radix, checked before conversion; exact logs retain the source and result. Node applies ToInt32 before radix validation and hexadecimal inference. The control keeps the route and substitutes position-indexed literal results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const radices: number[] = [
  -Infinity, Infinity, NaN, -0, 0, 0.9,
  -0.9, 1, -1, 37, -37, 2.9,
  4.9, 8.9, 10.9, 16.9, 32.9, 37.1,
  4294967296, 4294967298, 4294967312, 4294967333, -4294967280, -4294967296,
  -4294967294, 2147483648, 4294967295, 9007199254740992, Number.MAX_VALUE,
];
const expected: number[] = [
  16, 16, 16, 16, 16, 16, 16, NaN,
  NaN, NaN, NaN, 0, 0, 0, 0, 16,
  0, NaN, 16, 0, 16, NaN, 16, 16,
  0, NaN, NaN, 16, 16,
];
const log: unknown[] = [], wanted: unknown[] = [];
interface RadixInput { text: string; radix: number; }
function consume<T extends RadixInput>(input: T, index: number): number {
  same(input.text, "0x10"); same(input.radix, radices[index]);
  const value = expected[index]; same(value, expected[index]);
  log.push(input.text, input.radix, value); return value;
}
const retained: number[] = [], expectedRetained: number[] = [];
for (let index = 0; index < radices.length; index++) {
  const first = consume({ text: "0x10", radix: radices[index] }, index);
  const second = consume({ label: "extra", radix: radices[index], text: "0x10" }, index);
  same(first, expected[index]); same(second, expected[index]); retained.push(first, second);
  expectedRetained.push(expected[index], expected[index]);
  wanted.push("0x10", radices[index], expected[index], "0x10", radices[index], expected[index]);
}
same(retained.length, radices.length * 2);
for (let index = 0; index < retained.length; index++) same(retained[index], expectedRetained[index]);
assert.compareArray(log, wanted);
