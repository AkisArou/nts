/*---
description: "An interface-held offset ISO string is converted to UTC before TimeClip is applied."
features: [ts-date-routes, ts-date-route-text, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-generics, ts-generic-constraints]
---*/
// ISO input text crosses one typed parsing route; node returns finite milliseconds or NaN without consulting local time.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TextRow = { input: string; time: number };
const rows: TextRow[] = [
  { input: "1970-01-01T00:00:00.000+00:00", time: 0 }, { input: "1970-01-01T00:00:00.000-00:00", time: 0 },
  { input: "1970-01-01T00:00:00.000+01:00", time: -3600000 }, { input: "1969-12-31T23:00:00.000-01:00", time: 0 },
  { input: "2000-02-29T05:30:00.000+05:30", time: 951782400000 }, { input: "2020-12-31T23:59:59.999-01:00", time: 1609462799999 },
  { input: "0000-01-01T01:00:00.000+01:00", time: -62167219200000 }, { input: "-000001-01-01T01:00:00.000+01:00", time: -62198755200000 },
  { input: "9999-12-31T23:59:59.999-00:01", time: 253402300859999 }, { input: "+010000-01-01T00:00:00.000+00:01", time: 253402300740000 },
  { input: "-271821-04-19T23:00:00.000-01:00", time: -8640000000000000 }, { input: "+275760-09-13T01:00:00.000+01:00", time: 8640000000000000 },
  { input: "+275760-09-13T00:00:00.000-00:01", time: NaN }, { input: "-271821-04-20T00:00:00.000+00:01", time: NaN },
  { input: "1970-01-01T00:00:00.000+23:59", time: -86340000 }, { input: "1970-01-01T00:00:00.000+24:00", time: NaN },
  { input: "1970-01-01T00:00:00.000-00:60", time: NaN }
];
interface ISOInput { text: string }
function parse<T extends ISOInput>(value: T): number { return Date.parse(value.text); }
for (const row of rows) {
  const source: ISOInput = { text: row.input }, log: unknown[] = ["input", source.text], time = parse(source);
  log.push("parsed", time, "after", source.text); exact(log, ["input", row.input, "parsed", row.time, "after", row.input]);
}
