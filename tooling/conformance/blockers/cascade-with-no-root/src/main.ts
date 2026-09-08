// expect: emit-c --napi -> NTS1003 `make` cannot be compiled because it calls `Handle#hasRef`, which was refused above
//
// **`hir` reports `5 function(s), nothing refused` for this file.** Only
// `emit-c` produces the cascade, so the expectation has to name the command --
// which is the first thing this fixture demonstrates, before its own subject.
// A blocker that is invisible to `nts hir` is not a new idea here (`f64[]`
// lowers cleanly and fails at the wrapper) but this one carries an **NTS1003**,
// a lowering code, from a run that the lowering says was clean.
//
// The cascade names a refusal that **was never reported**. The whole output for
// this file is:
//
//     main.ts:24:9  NTS1003 `make` cannot be compiled because it calls
//                   `Handle#hasRef`, which was refused above
//     no wrapper for Immediate: is exported and is not a function this backend
//                   can name
//     no wrapper for make: is exported and no function of that name was compiled
//
// There is no `above`. Not one NTS1001 anywhere in the run. So the one
// actionable sentence points at something that does not exist in the output, and
// a reader following it finds nothing.
//
// **This is the diagnostic form of every instrument failure recorded in this
// document**: a result that cannot be distinguished from a different result. A
// cascade with a visible root tells you what to fix. A cascade with no root
// tells you only that something, somewhere, was not lowered -- and it is
// indistinguishable from a cascade whose root was printed and scrolled away.
//
// Reached from `timers`, whose `Immediate` class is generic over a tuple
// (`class Immediate<Args extends unknown[] = []>`) and implements an interface.
// The five real refusals there read `a member of Immediate, a class this
// compiler has no type for`, which at least names a cause; this reduction has
// lost even that while keeping the cascade.
//
// Two neighbours found on the way here and worth noting rather than fixturing
// separately, since both refuse cleanly and say why:
//
//   `new Immediate<[]>(fn, [])`   an array literal of unrepresentable type
//                                 (an untyped node)     -- the empty tuple
//   `#heap: (T | undefined)[]`    `null` or `undefined` where what it stands in
//                                 for is not a reference -- in `priority-queue`,
//                                 though not reproducible from that line alone

export interface Handle {
  ref(): Handle;
  hasRef(): boolean;
}

type Callback<Args extends unknown[]> = (...args: Args) => void;

export class Immediate<Args extends unknown[] = []> implements Handle {
  _onImmediate: Callback<Args> | null | undefined;
  _argv: Args;
  _refed = true;

  constructor(callback: Callback<Args>, args: Args) {
    this._onImmediate = callback;
    this._argv = args;
  }

  ref(): Handle {
    this._refed = true;
    return this;
  }

  hasRef(): boolean {
    return this._refed;
  }
}

export function make(a: number): boolean {
  const i = new Immediate<[number]>((n: number): void => {
    if (n < 0) return;
  }, [a]);
  return i.ref().hasRef();
}
