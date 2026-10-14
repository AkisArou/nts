// An `async` method started and drained.
//
// `work` is deliberately **not** async. The harness declares `double
// work(double)`, so an entry point returning a promise hands it a pointer it
// reads as a number and never gives back -- one leaked object that belongs to
// the harness rather than to the program. Starting the work and letting the
// drain finish it measures the same thing without that.

let total = 0;

class Counter {
  base: number;
  constructor(base: number) {
    this.base = base;
  }
  async scaled(by: number): Promise<number> {
    return this.base * by;
  }
  async accumulate(by: number): Promise<void> {
    const first = await this.scaled(by);
    total = total + first + this.base;
  }
}

export function work(n: number): number {
  total = 0;
  const c = new Counter(n);
  c.accumulate(1);
  c.accumulate(2);
  return n;
}
