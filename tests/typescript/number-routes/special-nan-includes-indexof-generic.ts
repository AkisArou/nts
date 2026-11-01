/*---
description: A constrained numeric search value preserves the NaN difference between includes and indexOf.
features: [ts-number-route-zero-nan, ts-numbers, ts-arrays, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Route: a search value crosses a number-constrained generic; node includes NaN but indexOf cannot find it.
function specialSearchValue<T extends number>(value: T): T { return value; }
const rows: { stored: number; query: number; raw: number; text: string; negative: boolean; found: boolean; index: number; indexText: string }[] = [
  { stored: 1, query: 1, raw: 1, text: "1", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 0, query: -0, raw: -0, text: "0", negative: true, found: true, index: 1, indexText: "1" },
  { stored: -0, query: 0, raw: 0, text: "0", negative: false, found: true, index: 1, indexText: "1" },
  { stored: NaN, query: NaN, raw: NaN, text: "NaN", negative: false, found: true, index: -1, indexText: "-1" },
  { stored: 1, query: NaN, raw: NaN, text: "NaN", negative: false, found: false, index: -1, indexText: "-1" },
  { stored: NaN, query: 1, raw: 1, text: "1", negative: false, found: false, index: -1, indexText: "-1" },
  { stored: 2 ** 31 - 1, query: 2 ** 31 - 1, raw: 2147483647, text: "2147483647", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 2 ** 31, query: 2 ** 31, raw: 2147483648, text: "2147483648", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 2 ** 32, query: 2 ** 32, raw: 4294967296, text: "4294967296", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 2 ** 53, query: 2 ** 53, raw: 9007199254740992, text: "9007199254740992", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 2 ** 53 + 2, query: 2 ** 53 + 2, raw: 9007199254740994, text: "9007199254740994", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 1.5, query: 1.5, raw: 1.5, text: "1.5", negative: false, found: true, index: 1, indexText: "1" },
  { stored: Infinity, query: Infinity, raw: Infinity, text: "Infinity", negative: false, found: true, index: 1, indexText: "1" },
  { stored: -Infinity, query: -Infinity, raw: -Infinity, text: "-Infinity", negative: false, found: true, index: 1, indexText: "1" },
  { stored: 1, query: 5, raw: 5, text: "5", negative: false, found: true, index: 0, indexText: "0" },
  { stored: 1, query: 7, raw: 7, text: "7", negative: false, found: true, index: 2, indexText: "2" },
];
for (const row of rows) {
  const raw: number = specialSearchValue(row.query);
  assert.sameValue(Object.is(raw, row.raw), true);
  assert.sameValue(typeof raw, "number");
  assert.sameValue(String(raw), row.text);
  if (raw === 0) assert.sameValue(Object.is(1 / raw, row.negative ? -Infinity : Infinity), true);
  const values: number[] = [5, row.stored, 7];
  const found: boolean = values.includes(raw);
  const index: number = values.indexOf(raw);
  assert.sameValue(Object.is(found, row.found), true);
  assert.sameValue(typeof found, "boolean");
  assert.sameValue(String(found), row.found ? "true" : "false");
  assert.sameValue(Object.is(index, row.index), true);
  assert.sameValue(typeof index, "number");
  assert.sameValue(String(index), row.indexText);
  if (index === 0) assert.sameValue(Object.is(1 / index, Infinity), true);
  assert.sameValue(values.length, 3);
  assert.sameValue(Object.is(values[1], row.stored), true);
}
