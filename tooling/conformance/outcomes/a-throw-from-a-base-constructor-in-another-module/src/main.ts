// **Ours, not upstream's: a throw from a base-class constructor declared in
// another module escapes the `try` around it.** `create` (derived.ts) builds a
// `Derived`, whose `super(type)` runs `Base`'s constructor (base.ts), which
// throws for an empty type. Called through a function value inside a `try`,
// the throw is not caught: the compiled program ends with "uncaught Error: no
// type" where node answers `caught`. Nothing is refused, so this is a silent
// wrong answer.
//
// The control differs in one thing and agrees: `Base` declared in derived.ts,
// beside `Derived`, prints `group caught` on main. It cannot share a file,
// since the difference is which module declares the base. Found beside
// `a-derived-constructor-whose-base-is-in-another-module`, which is the same
// layout one class deeper, and refused rather than wrong; this one is older
// (wrong on 9533b3a5e and on 46168ddfb alike).
//
// **Expected, confirmed under node:**
//
//     made     group caught
import { create } from "./derived.ts";

function run(make: (type: string) => { type: string }, type: string): string {
  try {
    return make(type).type;
  } catch (error) {
    return "caught";
  }
}

observe("made", run(create, "group") + " " + run(create, ""));
done();
