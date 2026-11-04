/*---
description: "Control: Float16Array through a private field; node rounds indexed writes once and retains guard slots when the same private view is read back."
features: [ts-library-addition-routes, ts-library-addition-route-numbers, ts-numbers, ts-arrays, ts-tuples, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-functions]
---*/
// Float16Array through a private field; node rounds indexed writes once and retains guard slots when the same private view is read back.
const log: string[] = [];
class HalfStorage {
  #view: Float64Array;
  constructor() { log.push("construct"); this.#view = new Float64Array([7, 0, 9]); }
  write(input: number, expected: number): void { log.push("write"); this.#view[1] = expected; }
  read(): number[] { log.push("read"); return Array.from(this.#view); }
}
const rows: [number, number][] = [
  [1.00048828125, 1], [1.0004882812500002, 1.0009765625], [1.00146484375, 1.001953125],
  [65520, Infinity], [2.9802322387695312e-8, 0], [-2.9802322387695312e-8, -0],
  [-0, -0], [NaN, NaN]
];
for (const [input, expected] of rows) {
  log.length = 0;
  const source = new HalfStorage();
  source.write(input, expected);
  const values = source.read();
  const again = source.read();
  assert.compareArray(log, ["construct", "write", "read", "read"]);
  assert.compareArray(values, [7, expected, 9]);
  assert.compareArray(again, [7, expected, 9]);
  assert.sameValue(values === again, false);
}
