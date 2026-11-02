/*---
description: "A typed JSON replacer receives builtin Date JSON text or null before changing each property value."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-unions, ts-null-undefined, ts-arrow-functions, ts-closures]
---*/
// An interface holds sampled and epoch Dates; node visits the root then each key, converts Dates before the replacer and preserves both numeric states.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TextRow = { input: number; time: number; text: string | null; json: string };
const rows: TextRow[] = [
  { input: 0, time: 0, text: "1970-01-01T00:00:00.000Z", json: "{\"stamp\":\"UTC:1970-01-01T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -0.0, time: 0, text: "1970-01-01T00:00:00.000Z", json: "{\"stamp\":\"UTC:1970-01-01T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -1, time: -1, text: "1969-12-31T23:59:59.999Z", json: "{\"stamp\":\"UTC:1969-12-31T23:59:59.999Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 951827696789, time: 951827696789, text: "2000-02-29T12:34:56.789Z", json: "{\"stamp\":\"UTC:2000-02-29T12:34:56.789Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 1609459199999, time: 1609459199999, text: "2020-12-31T23:59:59.999Z", json: "{\"stamp\":\"UTC:2020-12-31T23:59:59.999Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -62167219200000, time: -62167219200000, text: "0000-01-01T00:00:00.000Z", json: "{\"stamp\":\"UTC:0000-01-01T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -62198755200000, time: -62198755200000, text: "-000001-01-01T00:00:00.000Z", json: "{\"stamp\":\"UTC:-000001-01-01T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 253402300799999, time: 253402300799999, text: "9999-12-31T23:59:59.999Z", json: "{\"stamp\":\"UTC:9999-12-31T23:59:59.999Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 253402300800000, time: 253402300800000, text: "+010000-01-01T00:00:00.000Z", json: "{\"stamp\":\"UTC:+010000-01-01T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -8640000000000000, time: -8640000000000000, text: "-271821-04-20T00:00:00.000Z", json: "{\"stamp\":\"UTC:-271821-04-20T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 8640000000000000, time: 8640000000000000, text: "+275760-09-13T00:00:00.000Z", json: "{\"stamp\":\"UTC:+275760-09-13T00:00:00.000Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 1.9, time: 1, text: "1970-01-01T00:00:00.001Z", json: "{\"stamp\":\"UTC:1970-01-01T00:00:00.001Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -1.9, time: -1, text: "1969-12-31T23:59:59.999Z", json: "{\"stamp\":\"UTC:1969-12-31T23:59:59.999Z\",\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: NaN, time: NaN, text: null, json: "{\"stamp\":null,\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: Infinity, time: NaN, text: null, json: "{\"stamp\":null,\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -Infinity, time: NaN, text: null, json: "{\"stamp\":null,\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: 8640000000000001, time: NaN, text: null, json: "{\"stamp\":null,\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" },
  { input: -8640000000000001, time: NaN, text: null, json: "{\"stamp\":null,\"baseline\":\"UTC:1970-01-01T00:00:00.000Z\"}" }
];
interface TextHolder { stamp: Date; baseline: Date }
interface TextReplacer { (key: string, value: unknown): unknown }
for (const row of rows) {
  const holder: TextHolder = { stamp: new Date(row.input), baseline: new Date(0) }, log: unknown[] = ["before", holder.stamp.getTime(), holder.baseline.getTime()];
  const replace: TextReplacer = (key, value) => { if (key === "") { log.push("root", value === holder, typeof value); return value; } log.push("replace", key, typeof value, value); return typeof value === "string" ? "UTC:" + value : value; };
  const text = JSON.stringify(holder, replace); log.push("json", text, "after", holder.stamp.getTime(), holder.baseline.getTime()); assert.sameValue(text, row.json);
  exact(log, ["before", row.time, 0, "root", true, "object", "replace", "stamp", typeof row.text, row.text, "replace", "baseline", "string", "1970-01-01T00:00:00.000Z", "json", row.json, "after", row.time, 0]);
}
