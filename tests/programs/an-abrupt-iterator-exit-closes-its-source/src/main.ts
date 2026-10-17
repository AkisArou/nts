// IteratorClose is missing independently of lexical TDZ. Each control differs
// only by finishing the loop instead of taking its abrupt completion.
class ClosingIterator implements IterableIterator<number> {
  count = 0;
  closed = 0;
  next(): IteratorResult<number> { this.count++; return { value: this.count, done: this.count > 1 }; }
  return(): IteratorResult<number> { this.closed++; return { value: 0, done: true }; }
  [Symbol.iterator](): IterableIterator<number> { return this; }
}
export function breakSubject(n: number): number {
  const it = new ClosingIterator();
  for (const value of it) { if (value > 0) break; }
  return it.closed;
}
export function breakControl(n: number): number {
  const it = new ClosingIterator();
  for (const value of it) { if (value < 0) break; }
  return it.closed;
}
export function throwSubject(n: number): number {
  const it = new ClosingIterator();
  try { for (const value of it) { if (value > 0) throw 22; } } catch (e) { }
  return it.closed;
}
export function throwControl(n: number): number {
  const it = new ClosingIterator();
  try { for (const value of it) { if (value < 0) throw 22; } } catch (e) { }
  return it.closed;
}
