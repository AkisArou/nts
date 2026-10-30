/** Mulberry32, using only this explicit seeded state. */
export class Random {
  private state: number;
  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new Error("the seed must be a safe integer");
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  }
  integer(low: number, high: number): number {
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low > high) throw new Error("invalid random range");
    return low + Math.floor(this.next() * (high - low + 1));
  }
  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error("cannot choose from an empty list");
    return values[this.integer(0, values.length - 1)];
  }
  chance(): boolean { return this.next() < 0.5; }
}
