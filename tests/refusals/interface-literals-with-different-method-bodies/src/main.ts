// expect: a second object literal declaring
// Two literals at one contextual owner need different method tables.
// The explicit Named.return export is the working one-change control.
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
function literal(present: boolean): Source {
  if (present) return {
    count: 0, closed: 0,
    [Symbol.iterator]() { return this; },
    next() { const value = ++this.count; return { value, done: value > 2 }; },
    return() { this.closed = 1; return { value: 0, done: true }; },
  };
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
export function subject(n: number): number { return walk(literal(true), true); }
export function control(n: number): number { return walk(literal(false), true); }
export function namedControl(n: number): number {
  const source = new Named();
  source.return();
  return source.closed * 10 + source.count;
}
