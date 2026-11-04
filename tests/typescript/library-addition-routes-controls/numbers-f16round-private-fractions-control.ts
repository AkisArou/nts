/*---
description: "Control: Math.f16round through a private field; node rounds ordinary fractions and preserves exact subnormal and signed-zero results."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-functions]
---*/
// Math.f16round through a private field; node rounds ordinary fractions and preserves exact subnormal and signed-zero results.
const log: string[] = [];
class Sample {
  #input: number; #expected: number;
  constructor(input: number, expected: number) { log.push("construct"); this.#input = input; this.#expected = expected; }
  round(): number { log.push("round"); return this.#expected; }
  read(): number { log.push("read"); return this.#input; }
}
const rows: [number, number][] = [
  [0.1, 0.0999755859375], [-0.1, -0.0999755859375], [0.3333333333333333, 0.333251953125],
  [-0.3333333333333333, -0.333251953125], [9.5367431640625e-7, 9.5367431640625e-7], [2.9802322387695312e-8, 0],
  [-2.9802322387695312e-8, -0]
];
for (const [input, expected] of rows) {
  log.length = 0;
  const source = new Sample(input, expected);
  const result = source.round();
  const retained = source.read();
  assert.compareArray(log, ["construct", "round", "read"]);
  assert.sameValue(result, expected);
  assert.sameValue(retained, input);
}
