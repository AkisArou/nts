/*---
description: "JSON serializes a shared Date before and after an intervening getter mutates or recovers its UTC year."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-objects, ts-accessors, ts-closures]
---*/
// Three interface getters return one Date; node serializes each occurrence immediately, runs the UTC mutation once and emits the updated value at later keys.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TextRow = { input: number; time: number; after: number; json: string };
const rows: TextRow[] = [
  { input: 0, time: 0, after: 0, json: "{\"first\":\"1970-01-01T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: -0.0, time: 0, after: 0, json: "{\"first\":\"1970-01-01T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: -1, time: -1, after: 86399999, json: "{\"first\":\"1969-12-31T23:59:59.999Z\",\"reset\":\"1970-01-01T23:59:59.999Z\",\"last\":\"1970-01-01T23:59:59.999Z\"}" },
  { input: 951827696789, time: 951827696789, after: 45296789, json: "{\"first\":\"2000-02-29T12:34:56.789Z\",\"reset\":\"1970-01-01T12:34:56.789Z\",\"last\":\"1970-01-01T12:34:56.789Z\"}" },
  { input: 1609459199999, time: 1609459199999, after: 86399999, json: "{\"first\":\"2020-12-31T23:59:59.999Z\",\"reset\":\"1970-01-01T23:59:59.999Z\",\"last\":\"1970-01-01T23:59:59.999Z\"}" },
  { input: -62167219200000, time: -62167219200000, after: 0, json: "{\"first\":\"0000-01-01T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: -62198755200000, time: -62198755200000, after: 0, json: "{\"first\":\"-000001-01-01T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: 253402300799999, time: 253402300799999, after: 86399999, json: "{\"first\":\"9999-12-31T23:59:59.999Z\",\"reset\":\"1970-01-01T23:59:59.999Z\",\"last\":\"1970-01-01T23:59:59.999Z\"}" },
  { input: 253402300800000, time: 253402300800000, after: 0, json: "{\"first\":\"+010000-01-01T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: -8640000000000000, time: -8640000000000000, after: 0, json: "{\"first\":\"-271821-04-20T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: 8640000000000000, time: 8640000000000000, after: 0, json: "{\"first\":\"+275760-09-13T00:00:00.000Z\",\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: 1.9, time: 1, after: 1, json: "{\"first\":\"1970-01-01T00:00:00.001Z\",\"reset\":\"1970-01-01T00:00:00.001Z\",\"last\":\"1970-01-01T00:00:00.001Z\"}" },
  { input: -1.9, time: -1, after: 86399999, json: "{\"first\":\"1969-12-31T23:59:59.999Z\",\"reset\":\"1970-01-01T23:59:59.999Z\",\"last\":\"1970-01-01T23:59:59.999Z\"}" },
  { input: NaN, time: NaN, after: 0, json: "{\"first\":null,\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: Infinity, time: NaN, after: 0, json: "{\"first\":null,\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: -Infinity, time: NaN, after: 0, json: "{\"first\":null,\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: 8640000000000001, time: NaN, after: 0, json: "{\"first\":null,\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" },
  { input: -8640000000000001, time: NaN, after: 0, json: "{\"first\":null,\"reset\":\"1970-01-01T00:00:00.000Z\",\"last\":\"1970-01-01T00:00:00.000Z\"}" }
];
interface SharedTimes { first: Date; reset: Date; last: Date }
for (const row of rows) {
  const value = new Date(row.input), log: unknown[] = [];
  const holder: SharedTimes = {
    get first(): Date { log.push("first", value.getTime()); return value; },
    get reset(): Date { log.push("reset", value.getTime()); const changed = value.setUTCFullYear(1970, 0, 1); log.push("set", changed, value.getTime()); return value; },
    get last(): Date { log.push("last", value.getTime()); return value; }
  };
  const text = JSON.stringify(holder); log.push("json", text, "after", value.getTime()); assert.sameValue(text, row.json);
  exact(log, ["first", row.time, "reset", row.time, "set", row.after, row.after, "last", row.after, "json", row.json, "after", row.after]);
}
