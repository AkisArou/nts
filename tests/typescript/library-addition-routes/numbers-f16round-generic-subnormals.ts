/*---
description: "Math.f16round through a constrained generic argument; node keeps subnormal spacing, ties to even, normal-boundary carry and signed underflow."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-interfaces, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Math.f16round through a constrained generic argument; node keeps subnormal spacing, ties to even, normal-boundary carry and signed underflow.
const log: string[] = [];
interface Sample { input: number; expected: number; }
function round<T extends Sample>(source: T): number { log.push("round"); return Math.f16round(source.input); }
const rows: [number, number][] = [
  [2.9802322387695312e-8, 0], [2.980232238769532e-8, 5.960464477539063e-8], [2.980232238769531e-8, 0],
  [-2.9802322387695312e-8, -0], [-2.980232238769532e-8, -5.960464477539063e-8], [5.960464477539063e-8, 5.960464477539063e-8],
  [8.940696716308594e-8, 1.1920928955078125e-7], [1.4901161193847656e-7, 1.1920928955078125e-7], [0.00006097555160522461, 0.00006097555160522461],
  [0.000061005353927612305, 0.00006103515625], [0.00006103515625, 0.00006103515625]
];
for (const [input, expected] of rows) {
  log.length = 0;
  const source = { input, expected, marker: "sample" };
  const result = round(source);
  assert.compareArray(log, ["round"]);
  assert.sameValue(result, expected);
  assert.sameValue(source.input, input);
  assert.sameValue(source.marker, "sample");
}
