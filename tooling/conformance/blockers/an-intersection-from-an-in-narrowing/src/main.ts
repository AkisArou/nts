// expect: `href` on an intersection, which is erased here
//
// **This fixture exists to stop a fix, not to ask for one.**
//
// A value narrowed by `in` has an intersection type, and the concrete member of
// that intersection is a **synthetic record the checker made from the key
// name**:
//
//     if (typeof v === "object" && "href" in v)   ->   object & { href: unknown }
//
// So the obvious rule -- an intersection represents as whichever member has a
// concrete representation, since `object` and `unknown` constrain nothing --
// reads `href` at index zero of a record that exists only in the type system.
// The value is any object with an `href` at all, at whatever offset its own
// class gave it.
//
// It was implemented on 2026-09-12 and it looked like the best result of the
// day:
//
//     util     intersection refusals   12 -> 1
//     stream   intersection refusals   25 -> 1
//
// Then this program, whose `href` is the **third** field: 29 of 29 cases
// disagreed with node. A refusal had become a wrong answer that runs, which is
// the trade this compiler exists not to make.
//
// # The sentence to remember
//
// **`in` answers whether a property exists, not where it is.** This compiler has
// already paid for that once: `"x" in o` needed a presence bit in the object
// header precisely because a layout lookup cannot answer it. This is the same
// sentence one level up, and knowing it did not stop me writing the rule.
//
// # What a correct version needs
//
// The narrowing must establish a **layout**, not a property. `v instanceof C`
// does, and already lowers. A predicate returning `v is C` for a declared class
// does. A structural refinement over a receiver whose class is unknown cannot,
// and that is what all 37 corpus sites are -- so the fix here is not a better
// representation rule, it is a different narrowing.

class Site {
  padA: number;
  padB: number;
  href: number;
  constructor(n: number) {
    this.padA = 111;
    this.padB = 222;
    this.href = n;
  }
}

/**
 * Under test. `href` is third, so a read at the synthetic record's offset zero
 * answers `111` and a `typeof` guard against it answers the wrong way.
 */
export function inNarrowing(n: number): number {
  const v: unknown = new Site(n & 7);
  if (v !== null && typeof v === "object" && "href" in v && typeof v.href === "number") {
    return v.href;
  }
  return -1;
}

/** Control: `instanceof` establishes the layout, so this lowers and is right. */
export function viaInstanceof(n: number): number {
  const v: unknown = new Site(n & 7);
  if (v instanceof Site) {
    return v.href;
  }
  return -1;
}
