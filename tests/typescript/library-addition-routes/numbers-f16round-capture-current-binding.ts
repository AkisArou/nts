/*---
description: "Math.f16round through a captured let binding; node reads each current input after the holder is replaced and retains both rounded results."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-interfaces, ts-functions, ts-function-types, ts-closures, ts-arrow-functions]
---*/
// Math.f16round through a captured let binding; node reads each current input after the holder is replaced and retains both rounded results.
const log: string[] = [];
interface Sample { input: number; expected: number; }
const rows: [number, number][] = [
  [1.00146484375, 1.001953125], [65519.99999999999, 65504], [-2.9802322387695312e-8, -0],
  [-0, -0], [Infinity, Infinity]
];
for (const [input, expected] of rows) {
  log.length = 0;
  let source: Sample = { input, expected };
  const first = source;
  const round = (): number => { log.push("round"); return Math.f16round(source.input); };
  const result = round();
  source = { input: 1.00048828125, expected: 1 };
  const next = round();
  assert.compareArray(log, ["round", "round"]);
  assert.sameValue(result, expected);
  assert.sameValue(next, 1);
  assert.sameValue(first.input, input);
  assert.sameValue(source.input, 1.00048828125);
}
