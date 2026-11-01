// All loop bindings are ordinary locals: no capture can require a cell.
const values = new Float64Array(65536);
for (let at = 0; at < values.length; at++) values[at] = (at & 255) + 1;
let total: number = 0;
for (let at = 0; at < values.length; at++) {
  let value: number = 1;
  value = values[at]!;
  total += value;
}
export function work(iterations: number): number { return total * iterations; }

export const seed = 1;
