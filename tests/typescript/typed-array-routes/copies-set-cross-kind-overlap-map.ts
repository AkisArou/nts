/*---
description: "Set snapshots signed byte values from an overlapping one-byte alias before unsigned conversion changes the source view through a guarded Map get."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-map-set, ts-strings, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring]
---*/

// Set snapshots signed byte values from an overlapping one-byte alias before unsigned conversion changes the source view; route: a guarded Map get. Node prints copies-set-cross-kind-overlap-map:ok.
type Unsigned = Uint8Array;
type Signed = Int8Array;
type View = Unsigned | Signed;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
const rows: readonly [readonly number[], readonly number[], readonly number[], readonly number[]][] = [
  [[200, 100, 50, 25], [-56, 100], [200, 200, 100, 25], [-56, -56]],
  [[255, 128, 7, 11], [-1, -128], [255, 255, 128, 11], [-1, -1]],
];
for (const [input, before, expected, after] of rows) {
  const arrays: Map<string, Unsigned> = new Map([["sample", new Uint8Array(input)]]), target = arrays.get("sample");
  if (target === undefined) throw new Error("missing array");
  const source: Signed = new Int8Array(target.buffer, 0, 2);
  assert.compareArray(elements(source), before); assert.sameValue(source.buffer, target.buffer);
  const result: void = target.set(source, 1);
  assert.sameValue(result, undefined); assert.compareArray(elements(target), expected); assert.compareArray(elements(source), after);
}
console.log("copies-set-cross-kind-overlap-map:ok");
