/*---
description: A map callback receives the injected string as its real Map key identity.
features: [ts-unsound-covariant-array, ts-arrays, ts-map-set, ts-arrow-functions]
---*/
// TypeScript permits a number[] to reach an unknown[] writer. Its map
// callback still types each element as number; node passes the actual string.
function append(values: unknown[]): void {
  values.push("7");
}
const values: number[] = [2];
append(values);
const labels = new Map<unknown, string>([[2, "number"], ["7", "string"]]);
const seen = values.map((value: number) => labels.get(value));
assert.compareArray(seen, ["number", "string"]);
