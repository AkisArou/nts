// The control changes only early exit to exhaustion. Different layouts keep
// the two named iterator implementations distinct through their interface.
interface Source {
  count: number;
  closed: number;
  [Symbol.iterator](): Source;
  next(): { value: number; done: boolean };
  return(): { value: number; done: boolean };
}
class First implements Source {
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
class Second implements Source {
  count = 0;
  closed = 0;
  marker = 9;
  [Symbol.iterator](): Source { return this; }
  next(): { value: number; done: boolean } {
    const value = ++this.count;
    return { value, done: value > 2 };
  }
  return(): { value: number; done: boolean } {
    this.closed = 2;
    return { value: 0, done: true };
  }
}
function choose(n: number): Source {
  if (n < 0) return new First();
  return new Second();
}
function walk(source: Source, early: boolean): number {
  for (const value of source) { if (early) break; }
  return source.closed * 10 + source.count;
}
export function subject(n: number): number { return walk(choose(n), true); }
export function control(n: number): number { return walk(choose(n), false); }
// A future unlisted representation must stop by name on the unmatched close
// edge; the object-literal outcome reaches that edge. It is outside stepping.
// The second refusal is `class_sets`': `source` is one of two classes, so its
// calls are a test per class, and a receiver that is neither -- which the
// whole program says is none -- stops by name too.
// expect-ir: all: count call.extern(nts_refused) in walk == 2
