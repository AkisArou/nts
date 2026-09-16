// expect: compiles
//
// **A regression guard, as of 2026-09-16.** This was a blocker: `emit-c` exited
// zero and wrote C that clang rejected.
//
//     program.c:73: error: passing 'NtsString *' to parameter of incompatible
//     type 'NtsValue'
//
// A virtual call's arguments were coerced at lowering to the signature the
// **checker resolved**, and the call dispatches through the slot the
// **declaring class** spells. `Narrow.on(type: string, …)` is concrete;
// `Emitter#on(type: string | symbol, …)` is a union and therefore erased. The C
// backend casts the function *pointer* and leaves the arguments alone, because
// pointer-to-pointer is a cast and pointer-to-tagged-value is a construction.
//
// Nothing objected but clang, and only because one side is a struct: two
// mismatched *pointer* types would have compiled, linked and been wrong.
//
// # Where the fix is, and the two places it is not
//
// `specialize::insert_conversions`, which runs with `signatures::Expected` --
// the **final** signatures. It looked up `Callee::Direct` only, and its
// argument rule asked only about integers. Both gaps are one line each now.
//
// Not at lowering, although the ordering there is right and the declaring
// type's parameters are one lookup away: `unerase` and `specialize` narrow
// parameters *after* lowering, so coercing to the checker's declaration erases
// an argument the final function takes concretely. Tried; `fs` stopped
// building.
//
// Not in `verify` alone, although `Callee::Virtual` genuinely is skipped there
// and `compatible` already holds the rule -- two references interchangeable
// unless either is `Erased`. Adding it before the conversions turns a silent
// wrong answer into a red gate nobody can act on, and it surfaces a second,
// different class (`CallResultType`, `expected: Void, found: Erased`) in four
// modules. `docs/records/0340` carries that as the remaining work.
//
// # What this fixture is for now
//
// The refusal below is `Narrow#on`, an interface method with no body, and is
// not the subject. The subject is that what *is* emitted compiles.

class Emitter {
  seen = 0;
  on(type: string | symbol, by: number): void {
    void type;
    this.seen += by;
  }
}

class Loud extends Emitter {
  override on(type: string | symbol, by: number): void {
    void type;
    this.seen += by * 2;
  }
}

/** The narrowing. An interface member has no body, so a call through this type
 *  dispatches to the slot `Emitter` declares -- which takes the union. */
interface Narrow {
  on(type: string, by: number): void;
}

function through(target: Narrow, type: string, by: number): void {
  target.on(type, by);
}

export function drive(n: number): number {
  const e: Emitter = (n & 1) === 0 ? new Emitter() : new Loud();
  through(e, "x", n & 7);
  return e.seen;
}
