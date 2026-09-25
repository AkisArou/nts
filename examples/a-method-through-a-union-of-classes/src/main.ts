// A method called on a value typed as a **union of classes**: a test per arm and
// that arm's own call behind it.
//
// `class A { m() {} } class B { m() {} }` with `const x: A | B = …; x.m()` was
// refused as "`m` on an erased value, which has no method table here", and it is
// ordinary code: `dispatcher.dispatch(request)` in `web-platform`'s proxy agent
// is `Socks5ProxyAgent | ProxyAgent`, and `stats.isDirectory()` in `fs` is a
// union of two stat classes. 195 occurrences at 16 sites in the two runtimes.
//
// A union erases, so there is no method table to dispatch through -- and no slot
// number either: `Callee::Virtual`'s slot is numbered against the class that
// first declared the method, and two unrelated classes have no such class. So
// dispatch is a test per arm with a direct call behind it, which is the chain the
// JVM backend already emits for a field read through a union.
//
// **Built as lowering and not as an operation.** `OpenFieldGet` exists because a
// field read has to stay inside one HIR block; a call does not, so
// `Terminator::Branch` and a merge with a block parameter -- what this compiler
// already builds for `a ? b() : c()` -- are the whole of it. Every backend
// renders it today.
//
// # Controls
//
//     oneClass              the shape that lowered before this change
//     aSubclassArrives      a subclass of an arm must take that arm
//     threeArms             the chain is not two tests hard-coded
//     voidThroughAUnion     a `void` result has no value to merge
//     argumentsRunOnce      the arguments are evaluated before the first test
//
// The last is the load-bearing one. A chain that lowered its arguments inside
// each arm would pass every case above and run a side effect once per test taken.

class Direct {
  constructor(private readonly n: number) {}
  dispatch(by: number): number {
    return this.n + by;
  }
  drain(): void {
    this.drained = this.n;
  }
  drained = 0;
}

// **Deliberately a different layout from `Direct`.** Both classes holding one
// `number` made them one `Layout` -- structurally identical types are merged --
// so the cast each arm makes was the same cast and a wrong arm would still have
// read the right offset. `mark` in front of `n` means `Proxied`'s payload is in
// slot 1 where `Direct`'s is in slot 0, and reading one through the other's
// struct is a different number.
class Proxied {
  private readonly mark = 1;
  constructor(private readonly n: number) {}
  dispatch(by: number): number {
    return this.n * by + this.mark - 1;
  }
  drain(): void {
    this.drained = this.n * 2;
  }
  drained = 0;
}

class Tunnelled {
  constructor(private readonly n: number) {}
  dispatch(by: number): number {
    return this.n - by;
  }
}

/** A subclass of an arm, which the chain must recognise as that arm. */
class Pooled extends Direct {
  constructor(n: number) {
    super(n);
  }
}

/** The subject: two arms, and each answers differently. */
export function throughAUnion(n: number): number {
  const chosen: Direct | Proxied = n > 0 ? new Direct(n) : new Proxied(n);
  return chosen.dispatch(2);
}

/** **Control.** One class, which needed no chain and lowered before this. */
export function oneClass(n: number): number {
  return new Direct(n).dispatch(2);
}

/**
 * **Control.** A `Pooled` is a `Direct`, so the first arm's test has to admit
 * it. A chain built from the arm's own type alone falls through every test and
 * ends at the abort -- which is why the class list is `classes_under` and not
 * `vec![arm]`.
 */
export function aSubclassArrives(n: number): number {
  const chosen: Direct | Proxied = n > 0 ? new Pooled(n) : new Proxied(n);
  return chosen.dispatch(2);
}

/** **Control.** Three arms, each reachable, so the chain is not a pair. */
export function threeArms(n: number): number {
  const chosen: Direct | Proxied | Tunnelled =
    n > 1 ? new Direct(n) : n > 0 ? new Proxied(n) : new Tunnelled(n);
  return chosen.dispatch(2);
}

/**
 * **Control.** A `void` method has no value to merge, and a block parameter
 * carrying one would be read in the merge as a variable the C backend never
 * declared.
 */
export function voidThroughAUnion(n: number): number {
  const chosen: Direct | Proxied = n > 0 ? new Direct(n) : new Proxied(n);
  chosen.drain();
  return chosen.drained;
}

let calls = 0;
function counted(by: number): number {
  calls += 1;
  return by;
}

/**
 * **Control, and the one that matters.** The argument is evaluated once, before
 * the first test -- which is what a call does. A chain that lowered its
 * arguments inside each arm would call `counted` once per test taken: twice for
 * the second arm, and the answer would be 2 rather than 1.
 */
export function argumentsRunOnce(n: number): number {
  calls = 0;
  const chosen: Direct | Proxied = n > 0 ? new Direct(n) : new Proxied(n);
  chosen.dispatch(counted(2));
  return calls;
}
