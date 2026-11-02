/*---
description: Unary plus reads prefixed numeric strings from a typed field and rejects signed or incomplete nondecimal forms.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-class, ts-class-fields]
---*/
// Prefix strings are written into a declared field before unary plus; node logs full-string conversion rather than a parsed prefix.
const rows: [string, number][] = [
  ["0x10", 16.0], ["0Xff", 255.0], ["0o10", 8.0], ["0O77", 63.0], ["0b10", 2.0], ["0B101", 5.0], ["-0x10", NaN], ["+0x10", NaN], ["-0o10", NaN], ["+0o10", NaN], ["-0b10", NaN],
  ["+0b10", NaN], ["0x", NaN], ["0o", NaN], ["0b", NaN], ["0b2", NaN], ["0o8", NaN], ["0xg", NaN], ["0x1.8", NaN], ["0o1.2", NaN], ["00042", 42.0], ["077", 77.0], [" \n0x20\u2029", 32.0],
  ["0X20000000000000", 9007199254740992.0], ["0x20000000000001", 9007199254740992.0], ["0b0000", 0.0],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
class TextSlot { text: string = ""; }
function convert(index: number, slot: TextSlot): number {
  const value: string = slot.text;
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  const result: number = +value;
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const slot = new TextSlot(); slot.text = row[0];
  const result = convert(index, slot); assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
  expectedLog.push(row[0], row[1]);
}
assert.compareArray(seen, expectedLog);
