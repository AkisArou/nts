// A write before capture currently keeps a cell. Both compilers answer 1 per reader.
// The equal-value write makes the before compiler a valid A/B timing control.
const readers: (() => number)[] = [];
for (let turn = 0; turn < 4096; turn++) {
  let value: number = 1;
  value = 1;
  const read: () => number = () => value;
  readers.push(read);
}
export function work(iterations: number): number {
  const rounds = (iterations | 0) & 15;
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < readers.length; at++) sum += readers[at]!();
  }
  return sum;
}

export const seed = 1;
