/*---
description: A number-or-string union preserves raw special values before explicit ToInt32 normalization.
features: [ts-number-route-zero-nan, ts-numbers, ts-unions, ts-conversions, ts-functions]
---*/
// Route: a number|string parameter narrows naturally; node keeps raw -0 and NaN, then |0 produces +0.
function specialUnionNumber(value: number | string): number { return typeof value === "number" ? value : Number(value); }
const rows: { input: number; spelling: string; raw: number; text: string; normalized: number; intText: string; negative: boolean }[] = [
  { input: 1, spelling: "1", raw: 1, text: "1", normalized: 1, intText: "1", negative: false },
  { input: 0, spelling: "0", raw: 0, text: "0", normalized: 0, intText: "0", negative: false },
  { input: -0, spelling: "-0", raw: -0, text: "0", normalized: 0, intText: "0", negative: true },
  { input: 3.75, spelling: "3.75", raw: 3.75, text: "3.75", normalized: 3, intText: "3", negative: false },
  { input: -3.75, spelling: "-3.75", raw: -3.75, text: "-3.75", normalized: -3, intText: "-3", negative: false },
  { input: 2 ** 31 - 1, spelling: "2147483647", raw: 2147483647, text: "2147483647", normalized: 2147483647, intText: "2147483647", negative: false },
  { input: 2 ** 31, spelling: "2147483648", raw: 2147483648, text: "2147483648", normalized: -2147483648, intText: "-2147483648", negative: false },
  { input: 2 ** 32, spelling: "4294967296", raw: 4294967296, text: "4294967296", normalized: 0, intText: "0", negative: false },
  { input: 2 ** 53, spelling: "9007199254740992", raw: 9007199254740992, text: "9007199254740992", normalized: 0, intText: "0", negative: false },
  { input: 2 ** 53 + 2, spelling: "9007199254740994", raw: 9007199254740994, text: "9007199254740994", normalized: 2, intText: "2", negative: false },
  { input: NaN, spelling: "NaN", raw: NaN, text: "NaN", normalized: 0, intText: "0", negative: false },
  { input: Infinity, spelling: "Infinity", raw: Infinity, text: "Infinity", normalized: 0, intText: "0", negative: false },
  { input: -Infinity, spelling: "-Infinity", raw: -Infinity, text: "-Infinity", normalized: 0, intText: "0", negative: false },
];
for (const row of rows) {
  for (const useString of [false, true]) {
    const input: number | string = useString ? row.spelling : row.input;
    const raw: number = specialUnionNumber(input);
    assert.sameValue(Object.is(raw, row.raw), true);
    assert.sameValue(typeof raw, "number");
    assert.sameValue(String(raw), row.text);
    if (raw === 0) assert.sameValue(Object.is(1 / raw, row.negative ? -Infinity : Infinity), true);
    const normalized: number = raw | 0;
    assert.sameValue(Object.is(normalized, row.normalized), true);
    assert.sameValue(typeof normalized, "number");
    assert.sameValue(String(normalized), row.intText);
    if (normalized === 0) assert.sameValue(Object.is(1 / normalized, Infinity), true);
  }
}
