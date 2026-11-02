/*---
description: "Table control for partial-int-all-radix-rejection; A typed parser callback sees an out-of-alphabet leading digit in every valid radix from 2 through 36."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-type-aliases, ts-function-types, ts-arrow-functions]
---*/
// The callback receives original text and radix and logs its numeric result. Node returns NaN before mathematical integer approximation; successful unusual-radix results are deliberately not asserted. The control keeps the route and substitutes position-indexed literal results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const radices: number[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36,
];
const inputs: string[] = [
  "\t+2tail", "\t+3tail", "\t+4tail", "\t+5tail", "\t+6tail",
  "\t+7tail", "\t+8tail", "\t+9tail", "\t+Atail", "\t+Btail",
  "\t+Ctail", "\t+Dtail", "\t+Etail", "\t+Ftail", "\t+Gtail",
  "\t+Htail", "\t+Itail", "\t+Jtail", "\t+Ktail", "\t+Ltail",
  "\t+Mtail", "\t+Ntail", "\t+Otail", "\t+Ptail", "\t+Qtail",
  "\t+Rtail", "\t+Stail", "\t+Ttail", "\t+Utail", "\t+Vtail",
  "\t+Wtail", "\t+Xtail", "\t+Ytail", "\t+Ztail", "\t+@tail",
];
const expected: number[] = [
  NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN,
  NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN,
  NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN,
  NaN, NaN, NaN, NaN, NaN,
];
const log: unknown[] = [], wanted: unknown[] = [];
type Parser = (text: string, radix: number, index: number) => number;
function invoke(index: number, parser: Parser): number { return parser(inputs[index], radices[index], index); }
const parser: Parser = (text, radix, index) => {
  same(text, inputs[index]); same(radix, radices[index]);
  const value = expected[index]; same(value, expected[index]);
  log.push(text, radix, value); return value;
};
const retained: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const value = invoke(index, parser); same(value, expected[index]); retained.push(value);
  wanted.push(inputs[index], radices[index], expected[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expected[index]);
assert.compareArray(log, wanted);
