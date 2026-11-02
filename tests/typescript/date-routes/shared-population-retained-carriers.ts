/*---
description: "A loop population retains distinct Dates simultaneously in fields, arrays, Maps and returned closures."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-map-set, ts-closures, ts-arrow-functions, ts-function-types, ts-null-undefined, ts-narrowing, ts-errors]
---*/
// Fresh Dates cross four typed carriers before later writes; every mutation is followed by reading every population member through every carrier. Node keeps each identity and changes only the selected object.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0], [-0, 0, 0],
  [-1, -1, 86399999], [951827696789, 951827696789, 45296789],
  [946684799999, 946684799999, 86399999], [-62167219200000, -62167219200000, 0],
  [-62198755200000, -62198755200000, 0], [253402300799999, 253402300799999, 86399999],
  [253402300800000, 253402300800000, 0], [-8640000000000000, -8640000000000000, 0],
  [8640000000000000, 8640000000000000, 0], [NaN, NaN, 0],
];
interface DateSlot { stamp: Date; }
function capture(value: Date): () => Date { return () => value; }
const fields: DateSlot[] = [], values: Date[] = [], indexed: Map<number, Date> = new Map(), readers: (() => Date)[] = [], log: unknown[] = [], expected: unknown[] = [];
for (let i = 0; i < samples.length; i++) {
  const value: Date = new Date(samples[i][0]); for (const previous of values) same(value === previous, false);
  fields.push({ stamp: value }); values.push(value); indexed.set(i, value); readers.push(capture(value));
  log.push("create", i, value.getTime()); expected.push("create", i, samples[i][1]);
}
for (let i = 0; i < samples.length; i++) {
  const stored = indexed.get(i); if (stored === undefined) throw new Error("missing stored value");
  const target = i % 4 === 0 ? fields[i].stamp : i % 4 === 1 ? values[i] : i % 4 === 2 ? stored : readers[i]();
  const returned = target.setUTCFullYear(1970, 0, 1); log.push("write", i, returned); expected.push("write", i, samples[i][2]);
  for (let j = 0; j < samples.length; j++) {
    const member = indexed.get(j); if (member === undefined) throw new Error("lost stored value"); const wanted = j <= i ? samples[j][2] : samples[j][1];
    log.push("read", j, fields[j].stamp === values[j], member === values[j], readers[j]() === values[j], fields[j].stamp.getTime(), values[j].getTime(), member.getTime(), readers[j]().getTime());
    expected.push("read", j, true, true, true, wanted, wanted, wanted, wanted);
  }
}
exact(log, expected);
