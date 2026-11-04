/*---
description: "Math.f16round through an interface argument; node rounds positive and negative even and odd halfway significands to even."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-interfaces, ts-functions]
---*/
// Math.f16round through an interface argument; node rounds positive and negative even and odd halfway significands to even.
const log: string[] = [];
interface Sample { input: number; expected: number; }
function round(source: Sample): number { log.push("round"); return Math.f16round(source.input); }
const rows: [number, number][] = [
  [1.00048828125, 1], [1.00146484375, 1.001953125], [-1.00048828125, -1],
  [-1.00146484375, -1.001953125], [2049, 2048], [2051, 2052],
  [-2049, -2048], [-2051, -2052], [0.500244140625, 0.5],
  [0.500732421875, 0.5009765625]
];
for (const [input, expected] of rows) {
  log.length = 0;
  const source: Sample = { input, expected };
  const result = round(source);
  assert.compareArray(log, ["round"]);
  assert.sameValue(result, expected);
  assert.sameValue(source.input, input);
}
