/*---
description: "Arithmetic control for shared-population-retained-carriers; A loop population retains distinct Dates simultaneously in fields, arrays, Maps and returned closures."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// Fresh Dates cross four typed carriers before later writes; every mutation is followed by reading every population member through every carrier. Node keeps each identity and changes only the selected object. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
type SharedSample = [number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0], [-0, 0, 0],
  [-1, -1, 86399999], [951827696789, 951827696789, 45296789],
  [946684799999, 946684799999, 86399999], [-62167219200000, -62167219200000, 0],
  [-62198755200000, -62198755200000, 0], [253402300799999, 253402300799999, 86399999],
  [253402300800000, 253402300800000, 0], [-8640000000000000, -8640000000000000, 0],
  [8640000000000000, 8640000000000000, 0], [NaN, NaN, 0],
];
const cells: number[] = [], fields: number[] = [], values: number[] = [], indexed: number[] = [], captured: number[] = [], log: unknown[] = [], expected: unknown[] = [];
for (let i = 0; i < samples.length; i++) {
  const value = cells.length; for (const previous of values) same(value === previous, false); cells.push(clip(samples[i][0]));
  fields.push(value); values.push(value); indexed[i] = value; captured.push(value);
  log.push("create", i, cells[value]); expected.push("create", i, samples[i][1]);
}
for (let i = 0; i < samples.length; i++) {
  const target = i % 4 === 0 ? fields[i] : i % 4 === 1 ? values[i] : i % 4 === 2 ? indexed[i] : captured[i];
  const returned = cells[target] = reset(cells[target]); log.push("write", i, returned); expected.push("write", i, samples[i][2]);
  for (let j = 0; j < samples.length; j++) {
    const wanted = j <= i ? samples[j][2] : samples[j][1];
    log.push("read", j, fields[j] === values[j], indexed[j] === values[j], captured[j] === values[j], cells[fields[j]], cells[values[j]], cells[indexed[j]], cells[captured[j]]);
    expected.push("read", j, true, true, true, wanted, wanted, wanted, wanted);
  }
}
exact(log, expected);
