// A cycle whose modules both initialise, which is refused by name.
//
// Refused conservatively: nothing here reads across the cycle, and node runs
// this file happily, because a `function` declaration is hoisted and callable
// before its module has finished evaluating. What this compiler cannot do is
// tell that apart from the case that *does* read across --
//
//   // b.ts
//   import { armed } from "./a.js";
//   export let seen = armed;          // node: ReferenceError
//
// -- which was measured rather than assumed: the same three files as `.mjs`
// print `ReferenceError: Cannot access 'armed' before initialization`, because
// an ES binding before its initializer is in a temporal dead zone.
//
// This compiler has no temporal dead zone. A module-scope `let` is a global
// with a static initializer, so that read would quietly answer 0 instead of
// throwing, and the program would compute a plausible wrong number. Until
// there is something to throw with, a cycle whose modules initialise is
// refused whether or not this particular one would have been fine.
// Nothing exported reads `armed` or `b.ts`'s `seen`, and that is deliberate: a
// refused initializer leaves the program running *without* its module code
// rather than failing to build, so an export that read one would disagree with
// node for a second reason and hide the refusal this example is for.
import { fromB } from "./b.js";

let armed = 0;

armed = 1;

export function fromA(): number {
  return 10;
}

export function throughB(): number {
  return fromB();
}
