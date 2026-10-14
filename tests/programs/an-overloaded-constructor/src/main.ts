// Overloaded constructors, which produced **invalid HIR** rather than a
// refusal:
//
// ```text
// method overloads       lowered and agreed with node
// constructor overloads  EMIT FAILED -- refusing to emit code from invalid HIR
// single constructor     lowered and agreed with node
// ```
//
// `emit-c` wrote nothing and exited 0, so the next step failed for want of
// input and reported that instead -- the silently-unbuilt shape. 36 sites in
// `runtime/node`, all of them `buffer`'s `Blob` and `Buffer`, which declare
// `constructor(size: number); constructor(value: string, encoding?: string);`
// and so on.
//
// # One fact, spelled in three places
//
// A constructor has no `IDENTIFIER` child --- `constructor` is a keyword --- so
// anything naming a member from its children has to special-case it.
// `qualified_name` says so in its own words and handles it. Two other copies
// did not:
//
//   * `member_key`, which `is_an_overload_signature` uses to find a same-named
//     sibling *with* a body. A `None` key made every constructor signature
//     answer "not an overload", so the signature was lowered as though it were
//     an implementation.
//   * `implementation_of`'s local `named` closure, which walks from the
//     signature the checker resolved to the declaration that has the body.
//     Without it that function hands back the *signature*, and
//     `declared_parameters` follows to the implementation only when the two
//     differ --- so the arity a call is padded to came from the overload the
//     checker matched.
//
// The second is why fixing the first was not enough. `new C(4)` started
// working and `new C()` still did not:
//
//     invalid HIR: CallArgumentCount { func: "used",
//                    callee: "C#constructor", expected: 2, found: 1 }
//
// The zero-argument call matched `constructor()`, padded to nothing, and the
// emitted function takes `(this, a)`. Both copies now answer
// `CONSTRUCTOR_KEY`, which is named once so a fourth cannot drift from them.
//
// # Measured
//
// The row goes **36 sites to 5**, and `runtime/node` from 1,459 refusal sites
// to 1,432. Cascades *fall* as well, 10,071 to 10,000, which is the unusual
// direction and the point: a constructor that does not compile takes every
// call of it down too, so fixing one removes the refusal and its dependents
// together. `buffer` alone goes from 52 refusals to 45 with 9 of these to 0.
//
// # What still refuses, and is not this
//
// An **optional method declaration** -- `_final?(callback): void;` with no
// implementation beside it -- is the remaining 5. It is a signature a subclass
// may provide, not an overload of anything, and there is no body to emit. It
// keeps the message, which is accurate for it.

export class Sized {
  readonly n: number;

  constructor();
  constructor(a: number);
  constructor(a?: number) {
    this.n = a ?? 7;
  }

  get value(): number {
    return this.n;
  }
}

export function defaulted(x: number): number {
  const s = new Sized();
  return s.value + (x - x);
}

export function given(x: number): number {
  const s = new Sized(x);
  return s.value;
}

// Three signatures and two optional parameters, so the padding has more than
// one position to fill.
export class Pair {
  readonly total: number;

  constructor();
  constructor(a: number);
  constructor(a: number, b: number);
  constructor(a?: number, b?: number) {
    this.total = (a ?? 1) + (b ?? 2);
  }
}

export function pairDefault(x: number): number {
  return new Pair().total + (x - x);
}

export function pairOne(x: number): number {
  return new Pair(x).total;
}

export function pairBoth(x: number): number {
  return new Pair(x, x).total;
}

// Overloads of both kinds on one class, so the sibling walk meets a
// constructor and a method in the same member list.
export class Both {
  readonly n: number;

  constructor();
  constructor(a: number);
  constructor(a?: number) {
    this.n = a ?? 1;
  }

  pick(x: number): number;
  pick(x: number, y?: number): number {
    return x + (y ?? 0);
  }
}

export function bothKinds(x: number): number {
  const b = new Both();
  return b.n + b.pick(x);
}

// A subclass calling an overloaded base constructor through `super()`.
class Base {
  readonly n: number;

  constructor();
  constructor(a: number);
  constructor(a?: number) {
    this.n = a ?? 5;
  }
}

class Sub extends Base {
  constructor() {
    super();
  }
}

export function throughSuper(x: number): number {
  return new Sub().n + (x - x);
}
