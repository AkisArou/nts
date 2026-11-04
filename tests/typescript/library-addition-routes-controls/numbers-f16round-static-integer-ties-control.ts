/*---
description: "Control: Math.f16round through a static field; node uses ties-to-even at integer precision changes and distinguishes values adjacent to a midpoint."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-class, ts-class-fields, ts-static, ts-functions]
---*/
// Math.f16round through a static field; node uses ties-to-even at integer precision changes and distinguishes values adjacent to a midpoint.
const log: string[] = [];
class Sample {
  static input: number = 0;
  static expected: number = 0;
  static round(): number { log.push("round"); return Sample.expected; }
}
const rows: [number, number][] = [
  [1024.5, 1024], [1025.5, 1026], [2047.5, 2048],
  [2048.9999999999995, 2048], [2049, 2048], [2049.0000000000005, 2050],
  [-1024.5, -1024], [-1025.5, -1026]
];
for (const [input, expected] of rows) {
  log.length = 0;
  Sample.input = input; Sample.expected = expected;
  const result = Sample.round();
  assert.compareArray(log, ["round"]);
  assert.sameValue(result, expected);
  assert.sameValue(Sample.input, input);
}
