// A capacity larger than the initialized prefix, read repeatedly. This prices
// the runtime contract separately from dense arrays admitted by core's proof.
class Vector {
  storage: number[];
  count = 0;
  constructor(capacity: number) { this.storage = new Array<number>(capacity); }
  append(value: number): void { this.storage[this.count] = value; this.count++; }
  at(index: number): number { return this.storage[index]; }
}
export function work(seed: number): number {
  const vector = new Vector(8192);
  for (let i = 0; i < 4096; i++) vector.append((i ^ seed) & 1023);
  let sum = 0;
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < vector.count; i++) sum += vector.at(i);
  }
  return sum;
}
