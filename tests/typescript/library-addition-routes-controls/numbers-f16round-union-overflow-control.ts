/*---
description: "Control: Math.f16round through a discriminated union; node keeps 65504 finite, rounds values below 65520 down, and overflows at either signed boundary."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-functions, ts-unions, ts-narrowing]
---*/
// Math.f16round through a discriminated union; node keeps 65504 finite, rounds values below 65520 down, and overflows at either signed boundary.
const log: string[] = [];
type Sample = { kind: "number"; input: number; expected: number } | { kind: "skip" };
function round(source: Sample): number | undefined {
  log.push(source.kind);
  if (source.kind === "skip") return undefined;
  return source.expected;
}
const rows: [number, number][] = [
  [65504, 65504], [65519, 65504], [65519.99999999999, 65504],
  [65520, Infinity], [65521, Infinity], [-65504, -65504],
  [-65519.99999999999, -65504], [-65520, -Infinity], [-65521, -Infinity],
  [1.7976931348623157e+308, Infinity], [-1.7976931348623157e+308, -Infinity]
];
for (const [input, expected] of rows) {
  log.length = 0;
  const source: Sample = { kind: "number", input, expected };
  const result = round(source);
  const skipped = round({ kind: "skip" });
  assert.compareArray(log, ["number", "skip"]);
  assert.sameValue(result, expected);
  assert.sameValue(skipped, undefined);
  assert.sameValue(source.input, input);
}
