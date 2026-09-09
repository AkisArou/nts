// A getter whose declared return type includes `undefined`.
//
// The same body written as a *method* compiled and written as a getter did not:
// "`null` or `undefined` where what it stands in for is not a reference". The
// Node lane counted 59 occurrences in `fs` and reduced it to exactly that pair,
// with two further controls -- it is not the union, and a getter that never
// mentions `this` refuses too.
//
// The message sends a reader to widen a representation. There was no
// representation to widen: `enclosing_callable` listed four node kinds and not
// `GET_ACCESSOR`, so a `return` inside a getter walked past it, found no
// enclosing callable, and `undefined` had nothing to stand in for.
//
// Every case below is paired: a getter and a method with the same body, which
// must agree with node and with each other. A fixture with only the getters
// would pass on a compiler that got both wrong the same way.

class Holder {
  n: number;
  constructor(n: number) {
    this.n = n;
  }

  get numGet(): number | undefined {
    return this.n > 0 ? this.n : undefined;
  }
  numMethod(): number | undefined {
    return this.n > 0 ? this.n : undefined;
  }

  get strGet(): string | undefined {
    return this.n > 0 ? "positive" : undefined;
  }
  strMethod(): string | undefined {
    return this.n > 0 ? "positive" : undefined;
  }

  get boolGet(): boolean | undefined {
    return this.n > 0 ? true : undefined;
  }
  boolMethod(): boolean | undefined {
    return this.n > 0 ? true : undefined;
  }

  /** No `this` at all, which was the third control and refused identically. */
  get constantGet(): number | undefined {
    return undefined;
  }
}

export function numberThroughAGetter(n: number): number {
  return new Holder(n).numGet ?? -1;
}
export function numberThroughAMethod(n: number): number {
  return new Holder(n).numMethod() ?? -1;
}
export function stringThroughAGetter(n: number): number {
  return (new Holder(n).strGet ?? "none").length;
}
export function stringThroughAMethod(n: number): number {
  return (new Holder(n).strMethod() ?? "none").length;
}
export function booleanThroughAGetter(n: number): number {
  return (new Holder(n).boolGet ?? false) ? 1 : 0;
}
export function booleanThroughAMethod(n: number): number {
  return (new Holder(n).boolMethod() ?? false) ? 1 : 0;
}
export function noReceiver(n: number): number {
  return new Holder(n).constantGet ?? n;
}
