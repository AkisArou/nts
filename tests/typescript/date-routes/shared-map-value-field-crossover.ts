/*---
description: "A Map Date value and a typed field share writes without changing a separate equal-time Map value."
features: [ts-date-routes, ts-date-route-shared, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-tuples, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-map-set, ts-interfaces, ts-objects, ts-null-undefined, ts-narrowing, ts-errors]
---*/
// A Map<string, Date> lookup crosses an interface field; logs retain lookup identities, setter returns and both stored values. Node shares the primary object and preserves its independent peer.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type SharedSample = [number, number, number, number];
const samples: SharedSample[] = [
  [0, 0, 0, 456], [-0, 0, 0, 456],
  [-1, -1, 86399999, 86399456], [951827696789, 951827696789, 45296789, 45296456],
  [946684799999, 946684799999, 86399999, 86399456], [-62167219200000, -62167219200000, 0, 456],
  [-62198755200000, -62198755200000, 0, 456], [253402300799999, 253402300799999, 86399999, 86399456],
  [253402300800000, 253402300800000, 0, 456], [-8640000000000000, -8640000000000000, 0, 456],
  [8640000000000000, 8640000000000000, 0, 456], [NaN, NaN, 0, 456],
];
interface DateSlot { stamp: Date; }
function inspect(sample: SharedSample): void {
  const original: Date = new Date(sample[0]), peer: Date = new Date(sample[0]), values: Map<string, Date> = new Map([["primary", original], ["peer", peer]]);
  const found = values.get("primary"), other = values.get("peer"); if (found === undefined || other === undefined) throw new Error("missing value");
  const box: DateSlot = { stamp: found }, log: unknown[] = ["identity", found === original, other === peer, found === other, "initial", found.getTime(), other.getTime()];
  const first = found.setUTCFullYear(1970, 0, 1); log.push("map-write", first, box.stamp.getTime(), original.getTime(), other.getTime());
  const second = box.stamp.setUTCMilliseconds(456), again = values.get("primary"); if (again === undefined) throw new Error("lost value");
  log.push("field-write", second, again === original, again.getTime(), original.getTime(), other.getTime(), values.size);
  exact(log, ["identity", true, true, false, "initial", sample[1], sample[1], "map-write", sample[2], sample[2], sample[2], sample[1], "field-write", sample[3], true, sample[3], sample[3], sample[1], 2]);
}
for (const sample of samples) inspect(sample);
