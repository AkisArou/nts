/*---
description: A Date stored in an interface field reaches its builtin toJSON, including an invalid Date becoming null.
features: [ts-json-routes, ts-json-stringify, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-numbers, ts-tuples, ts-conversions]
---*/
// Serialize an interface containing Date; node emits its UTC ISO string or null for the invalid date.
interface JsonDateRecord { stamp: Date; order: number; }
const rows: [number, string][] = [
  [0, '"1970-01-01T00:00:00.000Z"'], [-1, '"1969-12-31T23:59:59.999Z"'],
  [86400000, '"1970-01-02T00:00:00.000Z"'], [NaN, "null"],
];
for (const [time, encoded] of rows) {
  const value: JsonDateRecord = { stamp: new Date(time), order: 1 };
  assert.sameValue(JSON.stringify(value), `{"stamp":${encoded},"order":1}`);
  assert.sameValue(Object.is(value.stamp.getTime(), time), true);
}
