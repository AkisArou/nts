// One interface is built both by a literal and a named class. The exhaustion
// control changes only whether the loop finishes early. The explicit method
// control keeps the named class live without relying on IteratorClose.
// Main47 agrees87/87; thea72 unlisted-interface stop regressed this subject.
// GetMethod(return) on the literal is undefined, so early exit must do nothing.
interface Source {
  count: number;
  closed: number;
  [Symbol.iterator](): Source;
  next(): { value: number; done: boolean };
  return?(): { value: number; done: boolean };
}
class Named implements Source {
  count = 0;
  closed = 0;
  [Symbol.iterator](): Source { return this; }
  next(): { value: number; done: boolean } {
    const value = ++this.count;
    return { value, done: value > 2 };
  }
  return(): { value: number; done: boolean } {
    this.closed = 1;
    return { value: 0, done: true };
  }
}
function literal(): Source {
  return {
    count: 0, closed: 0,
    [Symbol.iterator]() { return this; },
    next() { const value = ++this.count; return { value, done: value > 2 }; },
  };
}
function walk(source: Source, early: boolean): number {
  for (const value of source) { if (early) break; }
  return source.closed * 10 + source.count;
}
export function subject(n: number): number { return walk(literal(), true); }
export function control(n: number): number { return walk(literal(), false); }
export function namedControl(n: number): number {
  const source = new Named();
  source.return();
  return source.closed * 10 + source.count;
}
