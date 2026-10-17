// run: check
// The control changes only return's value to null, so GetMethod skips it.
class Source {
  count = 0;
  closed = 0;
  return: any;
  constructor(callable: boolean) {
    this.return = callable ? () => { this.closed++; return { done: true }; } : null;
  }
  [Symbol.iterator](): Source { return this; }
  next(): { value: number; done: boolean } { return { value: ++this.count, done: this.count > 1 }; }
}
function result(callable: boolean): number {
  const source = new Source(callable);
  for (const value of source) { break; }
  return source.closed;
}
export function subject(n: number): number { return result(true); }
export function control(n: number): number { return result(false); }
