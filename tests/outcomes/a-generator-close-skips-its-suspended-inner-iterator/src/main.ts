// run: check
// Closing the outer generator must unwind the inner iterator that spans yield.
// The control changes only the consumer's early-exit argument.
class ClosingIterator implements IterableIterator<number> {
  count = 0;
  closed = 0;
  next(): IteratorResult<number> {
    this.count++;
    return { value: this.count, done: this.count > 2 };
  }
  return(): IteratorResult<number> {
    this.closed++;
    return { value: 0, done: true };
  }
  [Symbol.iterator](): IterableIterator<number> { return this; }
}
function* wrapped(sequence: ClosingIterator): Generator<number> {
  for (const value of sequence) yield value;
}
function consume(sequence: Generator<number>, early: boolean): number {
  let total = 0;
  for (const value of sequence) {
    total += value;
    if (early) break;
  }
  return total;
}
export function broken(n: number): number {
  const sequence = new ClosingIterator();
  const total = consume(wrapped(sequence), true);
  return 10 * sequence.closed + total + (n & 0);
}
export function exhausted(n: number): number {
  const sequence = new ClosingIterator();
  const total = consume(wrapped(sequence), false);
  return 10 * sequence.closed + total + (n & 0);
}
