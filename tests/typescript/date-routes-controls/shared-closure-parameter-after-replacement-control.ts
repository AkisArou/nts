/*---
description: "Arithmetic control for shared-closure-parameter-after-replacement; A closure captures its Date argument object even after the source array entry is replaced."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// A Date parameter is captured by a returned reader; the source array is replaced and each object is mutated independently. Node keeps the reader attached to the old object, with exact identities, returns and times. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
function milliseconds(time: number, ms: number): number { return clip(Math.floor(time / 1000) * 1000 + ms); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0, 321], [-0, 0, 0, 321],
  [-1, -1, 86399999, -679], [951827696789, 951827696789, 45296789, 951827696321],
  [946684799999, 946684799999, 86399999, 946684799321], [-62167219200000, -62167219200000, 0, -62167219199679],
  [-62198755200000, -62198755200000, 0, -62198755199679], [253402300799999, 253402300799999, 86399999, 253402300799321],
  [253402300800000, 253402300800000, 0, 253402300800321], [-8640000000000000, -8640000000000000, 0, -8639999999999679],
  [8640000000000000, 8640000000000000, 0, NaN], [NaN, NaN, 0, NaN],
];
function inspect(sample: SharedSample): void {
  const cells = [clip(sample[0]), clip(sample[0])], original = 0, values = [original], captured = values[0];
  values[0] = 1;
  const log: unknown[] = ["replace", captured === original, captured === values[0], cells[captured], cells[values[0]]];
  const first = cells[original] = reset(cells[original]); log.push("old-write", first, cells[captured], cells[values[0]]);
  const second = cells[values[0]] = milliseconds(cells[values[0]], 321); log.push("new-write", second, cells[captured], cells[original], cells[values[0]]);
  exact(log, ["replace", true, false, sample[1], sample[1], "old-write", sample[2], sample[2], sample[1], "new-write", sample[3], sample[2], sample[2], sample[3]]);
  same(captured, original); same(captured === values[0], false);
}
for (const sample of samples) inspect(sample);
