// run: check
// Close controls add only a rest element, which exhausts in node.
// Element controls change only the source to a native array.
// Main skips the custom protocol for both short and rest patterns.
class Sequence implements IterableIterator<number> {
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
export function bindingSubject(n: number): number {
  const it = new Sequence();
  const [a] = it;
  return it.closed + (n & 0);
}
export function bindingControl(n: number): number {
  const it = new Sequence();
  const [a, ...r] = it;
  return it.closed + (n & 0);
}
export function assignmentSubject(n: number): number {
  const it = new Sequence();
  let a = 0;
  [a] = it;
  return it.closed + (n & 0);
}
export function assignmentControl(n: number): number {
  const it = new Sequence();
  let a = 0;
  let r: number[] = [];
  [a, ...r] = it;
  return it.closed + (n & 0);
}

export function bindingValueSubject(n: number): number {
  const it = new Sequence();
  const [a] = it;
  return a + (n & 0);
}
export function bindingValueControl(n: number): number {
  const it = new Sequence();
  const [a] = [1, 2];
  return a + (n & 0);
}
export function assignmentValueSubject(n: number): number {
  const it = new Sequence();
  let a = 0;
  [a] = it;
  return a + (n & 0);
}
export function assignmentValueControl(n: number): number {
  const it = new Sequence();
  let a = 0;
  [a] = [1, 2];
  return a + (n & 0);
}
