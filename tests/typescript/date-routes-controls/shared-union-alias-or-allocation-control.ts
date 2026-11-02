/*---
description: "Arithmetic control for shared-union-alias-or-allocation; A Date-or-number-or-string parameter aliases Date inputs and allocates independent objects for numeric and ISO inputs."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// A typed union narrows by instanceof and typeof before UTC mutation; logs keep branch, initial/final times and identity to the original. Node aliases the Date branch and allocates for numbers and explicit-zone ISO text. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function civil(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  for (const part of [year, month, day, hour, minute, second, ms]) if (!Number.isFinite(part)) return NaN;
  year = Math.trunc(year); month = Math.trunc(month); year += Math.floor(month / 12); month = (month % 12 + 12) % 12;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0), starts = [0,31,59,90,120,151,181,212,243,273,304,334];
  const days = 365 * (year - 1970) + Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400) - 477 + starts[month] + (leap && month > 1 ? 1 : 0) + Math.trunc(day) - 1;
  return days * 86400000 + Math.trunc(hour) * 3600000 + Math.trunc(minute) * 60000 + Math.trunc(second) * 1000 + Math.trunc(ms);
}
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
function parse(text: string): number {
  const wide = text[0] === "+" || text[0] === "-", end = wide ? 7 : 4, sign = text[0] === "-" ? -1 : 1;
  const year = sign * Number(text.slice(wide ? 1 : 0, end)), month = Number(text.slice(end + 1, end + 3)), day = Number(text.slice(end + 4, end + 6));
  const hour = Number(text.slice(end + 7, end + 9)), minute = Number(text.slice(end + 10, end + 12)), second = Number(text.slice(end + 13, end + 15)), ms = Number(text.slice(end + 16, end + 19)), zone = text.slice(end + 19);
  const zh = zone === "Z" ? 0 : Number(zone.slice(1, 3)), zm = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || zh > 23 || zm > 59) return NaN;
  return clip(civil(year, month - 1, day, hour, minute, second, ms) - (zone[0] === "-" ? -1 : 1) * (zh * 60 + zm) * 60000);
}
type SharedSample = [number, string, number, number];
const samples: SharedSample[] = [
  [0, "1970-01-01T01:30:00.000+01:30", 0, 0], [-0, "1970-01-01T00:00:00.000Z", 0, 0],
  [-1, "1970-01-01T00:59:59.999+01:00", -1, 86399999], [951827696789, "2000-02-29T12:34:56.789Z", 951827696789, 45296789],
  [946684799999, "1999-12-31T23:59:59.999Z", 946684799999, 86399999], [-62167219200000, "0000-01-01T00:00:00.000Z", -62167219200000, 0],
  [-62198755200000, "-000001-01-01T00:00:00.000Z", -62198755200000, 0], [253402300799999, "9999-12-31T23:59:59.999Z", 253402300799999, 86399999],
  [253402300800000, "+010000-01-01T00:00:00.000Z", 253402300800000, 0], [-8640000000000000, "-271821-04-20T00:00:00.000Z", -8640000000000000, 0],
  [8640000000000000, "+275760-09-13T00:00:00.000Z", 8640000000000000, 0], [NaN, "2000-01-01T00:00:00.000+24:00", NaN, 0],
];
function inspect(sample: SharedSample): void {
  for (const kind of ["date", "number", "string"]) {
    const cells = [clip(sample[0])], original = 0, log: unknown[] = [kind]; let chosen = original;
    if (kind === "number") { cells.push(clip(sample[0])); chosen = 1; } else if (kind === "string") { cells.push(parse(sample[1])); chosen = 1; }
    log.push("before", chosen === original, cells[chosen], cells[original]);
    const returned = cells[chosen] = reset(cells[chosen]); log.push("after", returned, cells[chosen], cells[original], chosen === original);
    const aliases = kind === "date"; exact(log, [kind, "before", aliases, sample[2], sample[2], "after", sample[3], sample[3], aliases ? sample[3] : sample[2], aliases]);
  }
}
for (const sample of samples) inspect(sample);
