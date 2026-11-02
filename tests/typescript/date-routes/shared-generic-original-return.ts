/*---
description: "A generic Date mutator returns its exact original object for Date and a declared-field subclass."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-class, ts-class-fields, ts-inheritance, ts-readonly, ts-generics, ts-generic-constraints]
---*/
// A constrained generic returns the Date it mutates, retaining a subclass tag; a later write through the return must reach only its original. Node preserves both identities, setter returns and independent states.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0, 777], [-0, 0, 0, 777],
  [-1, -1, 86399999, 86399777], [951827696789, 951827696789, 45296789, 45296777],
  [946684799999, 946684799999, 86399999, 86399777], [-62167219200000, -62167219200000, 0, 777],
  [-62198755200000, -62198755200000, 0, 777], [253402300799999, 253402300799999, 86399999, 86399777],
  [253402300800000, 253402300800000, 0, 777], [-8640000000000000, -8640000000000000, 0, 777],
  [8640000000000000, 8640000000000000, 0, 777], [NaN, NaN, 0, 777],
];
class TaggedTime extends Date { readonly tag: string; constructor(time: number, tag: string) { super(time); this.tag = tag; } }
function normalize<T extends Date>(value: T, log: unknown[]): T { const returned = value.setUTCFullYear(1970, 0, 1); log.push("normalize", returned, value.getTime()); return value; }
function inspect(sample: SharedSample): void {
  const original: Date = new Date(sample[0]), tagged = new TaggedTime(sample[0], "kept"), log: unknown[] = ["initial", original.getTime(), tagged.getTime()];
  const plain: Date = normalize(original, log), specific: TaggedTime = normalize(tagged, log);
  log.push("identity", plain === original, specific === tagged, plain === specific, "tag", specific.tag);
  const returned = plain.setUTCMilliseconds(777); log.push("returned-write", returned, original.getTime(), plain.getTime(), tagged.getTime(), specific.getTime(), specific.tag);
  exact(log, ["initial", sample[1], sample[1], "normalize", sample[2], sample[2], "normalize", sample[2], sample[2], "identity", true, true, false, "tag", "kept", "returned-write", sample[3], sample[3], sample[3], sample[2], sample[2], "kept"]);
}
for (const sample of samples) inspect(sample);
