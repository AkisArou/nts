/*---
description: "Math.f16round through a class field; node changes spacing across a power-of-two boundary and retains even midpoint selection."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-class, ts-class-fields, ts-functions]
---*/
// Math.f16round through a class field; node changes spacing across a power-of-two boundary and retains even midpoint selection.
const log: string[] = [];
class Sample {
  input: number; expected: number;
  constructor(input: number, expected: number) { log.push("construct"); this.input = input; this.expected = expected; }
  round(): number { log.push("round"); return Math.f16round(this.input); }
}
const rows: [number, number][] = [
  [32752, 32752], [32759.999999999996, 32752], [32760, 32768],
  [32760.000000000004, 32768], [32776, 32768], [32776.00000000001, 32768],
  [32792, 32800], [32816, 32832], [-32760, -32768],
  [-32776, -32768]
];
for (const [input, expected] of rows) {
  log.length = 0;
  const source = new Sample(input, expected);
  const result = source.round();
  assert.compareArray(log, ["construct", "round"]);
  assert.sameValue(result, expected);
  assert.sameValue(source.input, input);
}
