// `Array.from`, which is the walk with an append where the body would be.
//
// Everything `for...of` knows how to iterate arrives here for nothing: an
// array, a typed array, a string by code point, a `Map` or `Set`, a user type
// with `[Symbol.iterator]`, and a generator.

export function fromArray(n: number): number {
  const xs = [n, n + 1, n + 2];
  const copy = Array.from(xs);
  copy[0] = 99;
  // A copy, not an alias: `xs[0]` is untouched.
  return copy.length * 1000000 + copy[0] * 1000 + xs[0];
}

// A typed array, which the old `slice` path refused by name -- it reads
// elements as doubles or as pointers, and a `Uint8Array` is neither.
export function fromTyped(n: number): number {
  const u = new Uint8Array(4);
  u[0] = n;
  u[1] = n + 1;
  u[2] = 200;
  const xs = Array.from(u);
  return xs.length * 1000000 + xs[0] * 1000 + xs[2];
}

// A string, **by code point**. `"a\u{1F600}b"` is three items and its `length`
// is four, so this is the one shape where the answer differs from the obvious
// counted loop.
export function fromString(n: number): string {
  const cs = Array.from("a\u{1F600}b" + n);
  return cs.length + ":" + cs[1];
}

export function fromEmptyString(n: number): number {
  const cs = Array.from("");
  return cs.length + n;
}

// A `Set`, whose elements are its keys.
export function fromSet(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n + 1);
  s.add(n);
  const xs = Array.from(s);
  return xs.length * 1000 + xs[0];
}

// A `Set` with a hole in it: the walk asks the table for the next live entry
// rather than adding one to a position.
export function fromSetWithHoles(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n + 1);
  s.add(n + 2);
  s.delete(n + 1);
  const xs = Array.from(s);
  return xs.length * 1000 + xs[xs.length - 1];
}

// A `Map`'s keys and values, which read the table directly rather than
// building an iterator to throw away.
export function fromMapKeys(n: number): number {
  const m = new Map<number, number>();
  m.set(n, n * 10);
  m.set(n + 1, n * 20);
  const ks = Array.from(m.keys());
  const vs = Array.from(m.values());
  return ks.length * 1000000 + ks[0] * 1000 + vs[1];
}

// A user type with `[Symbol.iterator]`.
class Countdown {
  from: number;
  constructor(from: number) {
    this.from = from;
  }
  [Symbol.iterator](): CountdownIterator {
    return new CountdownIterator(this.from);
  }
}

class CountdownIterator {
  at: number;
  constructor(at: number) {
    this.at = at;
  }
  next(): { value: number; done: boolean } {
    if (this.at <= 0) {
      return { value: 0, done: true };
    }
    this.at = this.at - 1;
    return { value: this.at, done: false };
  }
}

export function fromIterable(n: number): number {
  const xs = Array.from(new Countdown(n % 6));
  return xs.length * 1000 + xs[0];
}

// A generator, which is the fifth walk and needed nothing of its own here.
function* squares(limit: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < limit) {
    yield i * i;
    i = i + 1;
  }
}

export function fromGenerator(n: number): number {
  const xs = Array.from(squares(n % 7));
  let total = 0;
  for (const value of xs) {
    total = total + value;
  }
  return xs.length * 1000000 + total;
}

// Managed elements, so the append is the reference one.
export function fromStrings(n: number): string {
  const words = ["a" + n, "b" + n];
  const copy = Array.from(words);
  return copy[0] + "|" + copy[1] + "|" + copy.length;
}

// Empty, of each kind that can be.
export function empties(n: number): number {
  // Not `[]`: an empty array literal has no representable element type, which
  // is a refusal of its own and would hide this one.
  const source: number[] = [];
  const a = Array.from(source);
  const s = Array.from(new Set<number>());
  const g = Array.from(squares(0));
  return (a.length + s.length + g.length) * 10 + (n > 0 ? 1 : 0);
}

// Twice over the same sequence: the second walk starts where the first did,
// because a `Set` is not a generator.
export function twice(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n + 1);
  const first = Array.from(s);
  const second = Array.from(s);
  return first.length * 1000 + second.length;
}

// Nested: an `Array.from` inside a loop over another one.
export function nested(n: number): number {
  // Built with `add` rather than `new Set([...])`, which is refused: a `Set`
  // constructed from contents needs the iteration protocol at the constructor.
  const seed = new Set<number>();
  seed.add(n);
  seed.add(n + 1);
  const outer = Array.from(seed);
  let total = 0;
  for (const value of outer) {
    const inner = Array.from(squares(value % 4));
    total = total + inner.length;
  }
  return total;
}
