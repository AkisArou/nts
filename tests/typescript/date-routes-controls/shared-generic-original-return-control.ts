/*---
description: "Arithmetic control for shared-generic-original-return; A generic Date mutator returns its exact original object for Date and a declared-field subclass."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator]
---*/
// A constrained generic returns the Date it mutates, retaining a subclass tag; a later write through the return must reach only its original. Node preserves both identities, setter returns and independent states. The control uses numeric cells and explicit alias indices without Date operations.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function clip(time: number): number { return Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? Math.trunc(time) + 0 : NaN; }
function reset(time: number): number { return Number.isFinite(time) ? ((time % 86400000) + 86400000) % 86400000 : 0; }
function milliseconds(time: number, ms: number): number { return clip(Math.floor(time / 1000) * 1000 + ms); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0, 777], [-0, 0, 0, 777],
  [-1, -1, 86399999, 86399777], [951827696789, 951827696789, 45296789, 45296777],
  [946684799999, 946684799999, 86399999, 86399777], [-62167219200000, -62167219200000, 0, 777],
  [-62198755200000, -62198755200000, 0, 777], [253402300799999, 253402300799999, 86399999, 86399777],
  [253402300800000, 253402300800000, 0, 777], [-8640000000000000, -8640000000000000, 0, 777],
  [8640000000000000, 8640000000000000, 0, 777], [NaN, NaN, 0, 777],
];
function inspect(sample: SharedSample): void {
  const cells = [clip(sample[0]), clip(sample[0])], original: number = 0, tagged: number = 1, tags = ["", "kept"], log: unknown[] = ["initial", cells[original], cells[tagged]];
  const plain = original; cells[plain] = reset(cells[plain]); log.push("normalize", cells[plain], cells[plain]);
  const specific = tagged; cells[specific] = reset(cells[specific]); log.push("normalize", cells[specific], cells[specific]);
  log.push("identity", plain === original, specific === tagged, plain === specific, "tag", tags[specific]);
  const returned = cells[plain] = milliseconds(cells[plain], 777); log.push("returned-write", returned, cells[original], cells[plain], cells[tagged], cells[specific], tags[specific]);
  exact(log, ["initial", sample[1], sample[1], "normalize", sample[2], sample[2], "normalize", sample[2], sample[2], "identity", true, true, false, "tag", "kept", "returned-write", sample[3], sample[3], sample[3], sample[2], sample[2], "kept"]);
}
for (const sample of samples) inspect(sample);
