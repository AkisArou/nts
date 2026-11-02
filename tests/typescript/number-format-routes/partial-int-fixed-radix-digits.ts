/*---
description: "Declared class fields carry text and one of the six exact radices into parseInt and retain its result."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-class, ts-class-fields, ts-tuples]
---*/
// The class fields are read before parsing and the result is written back, logged and retained. Node respects digit cutoffs, hexadecimal prefix stripping and exact binary rounding in radices 2, 4, 8, 10, 16 and 32.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: [string, number][] = [
  ["1012tail", 2], ["-000", 2], ["1023x", 4],
  ["38", 4], ["77x", 8], ["08", 8],
  ["15e2", 10], ["0x10", 10], ["0x10", 16],
  ["-0Xf", 16], ["0x", 16], ["ffFtail", 16],
  ["g", 16], ["vVw", 32], ["0x10", 32],
  ["-v", 32], ["1fffffffffffff", 16], ["20000000000001", 16],
  ["9007199254740993", 10],
];
const expected: number[] = [
  5, -0, 75, 3, 63, 0,
  15, 0, 16, -15, NaN, 4095,
  NaN, 1023, 0, -31, 9007199254740991, 9007199254740992,
  9007199254740992,
];
const log: unknown[] = [], wanted: unknown[] = [];
class ParseCell {
  text: string; radix: number; value: number = NaN;
  constructor(text: string, radix: number) { this.text = text; this.radix = radix; }
}
const retained: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const slot: ParseCell = new ParseCell(inputs[index][0], inputs[index][1]);
  same(slot.text, inputs[index][0]); same(slot.radix, inputs[index][1]);
  slot.value = parseInt(slot.text, slot.radix); same(slot.value, expected[index]); retained.push(slot.value);
  log.push(slot.text, slot.radix, slot.value); wanted.push(inputs[index][0], inputs[index][1], expected[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expected[index]);
assert.compareArray(log, wanted);
