// expect: a function that itself calls something whose `throw` cannot be carried
//
// **The other half of `examples/a-method-that-calls-a-callback-held-in-a-field-inside-a-
// try`, which that file cannot hold**: the same program with the program-global raising
// gate **off**.
//
// A call through a value is carried by `Hierarchy::raising_call_slot` or not at all, and
// that slot may only be dispatched at where *every* raising body this program would build
// can carry what it calls -- `every_raising_body_can_carry`, which is program-global
// because which closure arrives at a signature is what nobody at the site can know. So
// the two halves cannot be arms of one file: the gate is a property of the whole program,
// and a file holding both would have it off for all of it.
//
// What turns it off here is the closure's own body: `new Thing(n)` constructs a class this
// program declares whose constructor can throw, and a `new` resolves to a `Constructor`,
// which is never eligible for a raising copy. One such closure is enough.
//
// **Why this file exists at all.** Without the gate, this program was a *silent* wrong
// answer -- `nts: uncaught RangeError` on 8 of 29 cases where node answers `-1` -- and the
// refusal that replaced it is the only thing standing between the gate being off and a
// `throw` leaving a `try` that compiled. A refusal with no fixture does not fail when it
// expires, so the day someone makes a plain copy name an entry the gate withheld, this is
// what says so.
//
// The control must go on compiling, and it is the arm that keeps the rule from being "a
// `try` is refused when the gate is off": a callee that is a **declaration** has a copy to
// name, gate or no gate.

class Thing {
  readonly n: number;
  constructor(n: number) {
    if (n > 5) {
      throw new RangeError("thing");
    }
    this.n = n;
  }
}

class Holder {
  cb: ((n: number) => number) | null = null;
  run(n: number): number {
    const f = this.cb;
    if (f) {
      return f(n);
    }
    return n * 3;
  }
}

const held = new Holder();
// The closure that turns the gate off: it constructs a program class that can throw.
held.cb = (n: number): number => new Thing(n).n;

/** Refused: `run` calls a closure held in a field and no entry can carry its `throw`. */
export function guarded(n: number): number {
  try {
    return held.run(n & 7);
  } catch {
    return -1;
  }
}

/** The control: a callee that is a declaration, so its raising copy is named directly. */
export function throughADeclaration(n: number): number {
  try {
    return made(n & 7);
  } catch {
    return -1;
  }
}

function made(n: number): number {
  if (n > 5) {
    throw new RangeError("from the function");
  }
  return n * 4;
}
