// A `function` *declaration* that reads its own `this` takes the call's, as a
// `function` expression does (`docs/function-receivers.md`). Its body is
// lowered taking the `this` first; its name is an entry passing `undefined`,
// which is what a plain call, an importer and the export surface reach. A call
// that has a `this` -- `f.call(r)`, `o.f()` through a field, a bound function
// -- reaches the body with it. One nested in a function that captures is a
// closure, and takes it the same way.

interface Valued {
  v: number;
}

class Box {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

function read(this: Valued, plus: number): number {
  return this.v * 10 + plus;
}

/** `f.call(r, x)` and `f.apply(r, [x])`, on a literal and on a class. */
export function callAndApply(n: number): number {
  return read.call({ v: n & 7 }, 1) * 1000 + read.apply(new Box(n & 3), [2]);
}

interface Method extends Valued {
  m: (this: Valued, plus: number) => number;
}

/** Stored in a field and called as a method: `o.m()` passes `o`. */
export function asAMethod(n: number): number {
  const o: Method = { v: n & 7, m: read };
  const p: Method = { v: 9, m: read };
  return o.m(1) * 1000 + p.m(2);
}

/** Bound, then called without a receiver. */
export function bound(n: number): number {
  const f = read.bind(new Box(n & 7));
  return f(3);
}

function kind(this: unknown): string {
  return typeof this;
}

/** A plain call's `this` is `undefined`; `.call` passes what it is given. */
export function plainAndGiven(n: number): string {
  return kind() + " " + kind.call(n) + " " + kind.call("s") + " " + kind.call(new Box(n));
}

function forward(this: unknown, f: (this: unknown) => string): string {
  return f.call(this);
}

/** A body that hands its own `this` on. */
export function handedOn(n: number): string {
  return forward.call(new Box(n), kind) + " " + forward(kind);
}

/** Nested, capturing a local: a closure that takes the call's `this`. */
export function nestedCapturing(n: number): number {
  const base = n & 7;
  function add(this: Valued, k: number): number {
    return this.v + base + k;
  }
  return add.call({ v: 100 }, 1) + add.call(new Box(1000), 2);
}

/**
 * An anonymous `this` type, given a literal of it: the subject of the blocker
 * this replaced, `enclosing-scope-name-in-a-nested-function`, which a nested
 * function that captures and reads `this` stood behind until it became a
 * closure taking the call's.
 */
export function anAnonymousThis(columns: number): number {
  function visit(this: { offset: number }, index: number): number {
    return index * columns + this.offset;
  }
  return visit.call({ offset: 1 }, 2);
}

/** Nested, capturing nothing: a function of the program, as at module scope. */
export function nestedPlain(n: number): number {
  function twice(this: Valued): number {
    return this.v * 2;
  }
  return twice.call({ v: n & 15 });
}

function failing(this: Valued, limit: number): number {
  if (this.v > limit) {
    throw new Error("over " + String(limit));
  }
  return this.v;
}

/** A `throw` from such a body, caught around the call. */
export function caught(n: number): string {
  try {
    return String(failing.call({ v: n & 7 }, 3));
  } catch (e) {
    return (e as Error).message;
  }
}

async function later(this: Valued, plus: number): Promise<number> {
  await Promise.resolve(0);
  return this.v + plus;
}

/** `async`: the `this` survives the suspension. */
export async function afterAwait(n: number): Promise<number> {
  return await later.call(new Box(n & 7), 1);
}
