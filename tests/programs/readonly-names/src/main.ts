// `readonly` belongs to a property, not to a name.
//
// Whether a property is readonly used to be decided by searching the whole
// program for *any* declaration carrying the modifier that had a child with
// the same text. So one `readonly count` anywhere made every `count`
// everywhere readonly, and writing to any of them was refused -- for names
// common enough that something declares them readonly, which in `runtime/node`
// meant `length`, `destroyed`, `closed`, `chunks`, `port`, `resolve`,
// `finished`, `root`, `name` and `path`.
//
// Every pair below shares a name with a readonly property declared beside it.

class Frozen {
  readonly count: number;
  readonly label: string;
  constructor(count: number, label: string) {
    this.count = count;
    this.label = label;
  }
}

// The same names, not readonly. Each of these assignments is legal TypeScript.
class Counter {
  count = 0;
  label = "";
}

export function writesTheMutableOne(n: number): number {
  const c = new Counter();
  c.count = n;
  c.count += 1;
  c.count = c.count * 2;
  return c.count;
}

export function readsTheFrozenOne(n: number): number {
  const f = new Frozen(n, "f");
  return f.count + f.label.length;
}

export function bothAtOnce(n: number): number {
  const f = new Frozen(n, "frozen");
  const c = new Counter();
  c.count = f.count + 1;
  c.label = f.label + "!";
  return c.count * 100 + c.label.length;
}

// A `readonly` property in a *base*, and a plain one of the same name in an
// unrelated class. Inheritance still has to make the first readonly, which is
// what asking the property's own declaration preserves.
class FrozenBase {
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
}

class FrozenChild extends FrozenBase {
  extra: number;
  constructor(size: number, extra: number) {
    super(size);
    this.extra = extra;
  }
}

class Sizeable {
  size = 0;
}

export function inheritedReadonlyStillReads(n: number): number {
  const child = new FrozenChild(n, n + 1);
  return child.size * 10 + child.extra;
}

export function theUnrelatedSizeIsWritable(n: number): number {
  const s = new Sizeable();
  s.size = n;
  s.size += 2;
  return s.size;
}

// A property whose name is `length`, which the runtime also uses for arrays and
// strings and which `lib.d.ts` declares readonly in several places.
class Buffered {
  length = 0;
  chunks: number;
  constructor(chunks: number) {
    this.chunks = chunks;
  }
}

export function writesLength(n: number): number {
  const b = new Buffered(n);
  b.length = n;
  b.length += b.chunks;
  return b.length;
}

// Written through a method rather than at the top level, which is the shape
// `runtime/node` uses and where the refusal actually landed.
class Accumulator {
  total = 0;
  add(n: number): void {
    this.total += n;
  }
  reset(): void {
    this.total = 0;
  }
}

export function throughAMethod(n: number): number {
  const a = new Accumulator();
  a.add(n);
  a.add(n + 1);
  const first = a.total;
  a.reset();
  return first * 100 + a.total;
}
