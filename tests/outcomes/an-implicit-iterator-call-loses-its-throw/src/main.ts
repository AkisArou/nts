// run: check
// The control changes only which protocol method throws.
class Source implements IterableIterator<number> {
  count = 0;
  closed = 0;
  constructor(public failure: number) {}
  [Symbol.iterator](): IterableIterator<number> {
    if (this.failure === 1) throw 22;
    return this;
  }
  next(): IteratorResult<number> {
    if (this.failure === 2) throw 22;
    this.count++;
    return { value: this.count, done: this.count > 1 };
  }
  return(): IteratorResult<number> {
    this.closed++;
    return { value: 0, done: true };
  }
}
function observed(failure: number): number {
  const source = new Source(failure);
  let total = 0;
  try { for (const value of source) total += value; }
  catch (e) { return e === 22 ? 100 + source.closed : -1; }
  return total;
}
export function iteratorSubject(n: number): number { return observed(n === 1 ? 1 : 0) + (n & 0); }
export function iteratorControl(n: number): number { return observed(0) + (n & 0); }
export function nextSubject(n: number): number { return observed(n === 1 ? 2 : 0) + (n & 0); }
export function nextControl(n: number): number { return observed(0) + (n & 0); }
