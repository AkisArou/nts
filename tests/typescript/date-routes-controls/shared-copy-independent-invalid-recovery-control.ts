/*---
description: "Arithmetic control for shared-copy-independent-invalid-recovery; Copying a Date preserves its initial time and ISO text while both copies retain independent UTC mutation and invalid recovery."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-unions, ts-null-undefined, ts-errors, ts-arrow-functions]
---*/
// A Date argument reaches new Date(date); initial ISO output includes expanded years, then each object changes separately. Node creates a distinct copy and lets an invalid original and copy recover independently. The control uses numeric cells and explicit alias indices without Date operations.
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
function parts(time: number): number[] {
  if (!Number.isFinite(time)) return [NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN];
  const day = Math.floor(time / 86400000); let low = -300000, high = 300001;
  while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (civil(middle, 0, 1) / 86400000 <= day) low = middle; else high = middle; }
  let month = 0; while (month < 11 && civil(low, month + 1, 1) / 86400000 <= day) month++;
  const clock = time - day * 86400000; return [low, month, day - civil(low, month, 1) / 86400000 + 1, Math.floor(clock / 3600000), Math.floor(clock / 60000) % 60, Math.floor(clock / 1000) % 60, clock % 1000, ((day + 4) % 7 + 7) % 7];
}
function iso(time: number): string {
  if (!Number.isFinite(time)) throw new RangeError(); const p = parts(time), pad = (n: number, width: number): string => String(n).padStart(width, "0"), year = p[0] >= 0 && p[0] <= 9999 ? pad(p[0], 4) : (p[0] < 0 ? "-" : "+") + pad(Math.abs(p[0]), 6);
  return year + "-" + pad(p[1] + 1, 2) + "-" + pad(p[2], 2) + "T" + pad(p[3], 2) + ":" + pad(p[4], 2) + ":" + pad(p[5], 2) + "." + pad(p[6], 3) + "Z";
}
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
type SharedSample = [number, number, number, number, string | null];
const samples: SharedSample[] = [
  [0, 0, 0, 951782400000, "1970-01-01T00:00:00.000Z"], [-0, 0, 0, 951782400000, "1970-01-01T00:00:00.000Z"],
  [-1, -1, 86399999, 951868799999, "1969-12-31T23:59:59.999Z"], [951827696789, 951827696789, 45296789, 951827696789, "2000-02-29T12:34:56.789Z"],
  [946684799999, 946684799999, 86399999, 951868799999, "1999-12-31T23:59:59.999Z"], [-62167219200000, -62167219200000, 0, 951782400000, "0000-01-01T00:00:00.000Z"],
  [-62198755200000, -62198755200000, 0, 951782400000, "-000001-01-01T00:00:00.000Z"], [253402300799999, 253402300799999, 86399999, 951868799999, "9999-12-31T23:59:59.999Z"],
  [253402300800000, 253402300800000, 0, 951782400000, "+010000-01-01T00:00:00.000Z"], [-8640000000000000, -8640000000000000, 0, 951782400000, "-271821-04-20T00:00:00.000Z"],
  [8640000000000000, 8640000000000000, 0, 951782400000, "+275760-09-13T00:00:00.000Z"], [NaN, NaN, 0, 951782400000, null],
];
function inspect(sample: SharedSample): void {
  const original: number = 0, cells = [clip(sample[0])]; cells.push(cells[original]); const copy: number = 1, log: unknown[] = ["copy", copy === original, cells[original], cells[copy]];
  if (sample[4] === null) { assert.throws(RangeError, () => iso(cells[original])); assert.throws(RangeError, () => iso(cells[copy])); }
  else { assert.sameValue(iso(cells[original]), sample[4]); assert.sameValue(iso(cells[copy]), sample[4]); }
  const first = cells[original] = reset(cells[original]); log.push("original-write", first, cells[original], cells[copy]);
  const second = cells[copy] = clip(civil(2000, 1, 29) + reset(cells[copy])); log.push("copy-write", second, cells[original], cells[copy]);
  exact(log, ["copy", false, sample[1], sample[1], "original-write", sample[2], sample[2], sample[1], "copy-write", sample[3], sample[2], sample[3]]);
}
for (const sample of samples) inspect(sample);
