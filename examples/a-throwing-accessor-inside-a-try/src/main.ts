// An accessor that throws, with the handler outside it.
//
// **An accessor is a call**, which is the first sentence of `examples/accessors` and
// the thing the raising work kept having to be told: `c.checked` runs a `get` and
// `c.checked = v` runs a `set`, and nothing in the syntax says which -- or that either
// is a call at all. `call_within` has refused a `try` over one since 6 of 29 cases
// declined without the rule, and the census counted **705 occurrences** of "an
// accessor, which is a call": the other half of the item `ac1533ca4` opened and the
// last of it.
//
// It compiles now, the same way a method does. `accessor_callee` already made a member
// no subclass overrides a `Callee::Direct`, so the raising copy is that name with
// `@raises` on it and no dispatch slot is needed. Where the dispatch *is* virtual there
// is no name to suffix, which is the one arm still refused.
//
// # The arms, and why each is here
//
//     a getter read            `Box#get doubled@raises`, named at the read
//     a setter write           `Box#set checked@raises`; an assignment is not a call
//                              node, so nothing keyed on one ever saw it
//     a compound assignment    reads through the `get` and writes through the `set`,
//                              which is two accessor calls in one statement
//     a static accessor        addressed by the class, so `accessor_callee` is not on
//                              its path at all -- a third place that names one
//     a quiet getter           **the control**: no copy, no flag test, nothing for the
//                              `try` to do. It is what catches a rule that makes every
//                              guarded accessor pay, and it refused for a while
//     an overridden getter     refused, and the boundary: the dispatch is a
//                              `Callee::Virtual` through a slot, and a slot holds no
//                              name to suffix
//
// # Three holes this file found, none of which the plan predicted
//
// **`a_call_that_can_raise` read the receiver rather than the member.**
// `children(access).first()` is the callee of a call and the *object* of an access, so
// an access answered "can this raise" about whatever `box` is. Harmless only while an
// accessor was refused before anything asked -- and it refused `return box.plain`
// beside the throwing getter, because a quiet accessor is in no `copyable` set and so
// has no copy to find.
//
// **`Place::Setter` carried no node.** The two callees are resolved for the access
// `o.x` and the raise was tested at the *assignment* node, which `raising_calls` does
// not hold: the call named `Owner#set x@raises` and **nothing looked at the flag** --
// 16 of 32 cases, with the `try` compiled and the `throw` recorded and dropped. The
// access node travels on the place now, so a callee and the node it was chosen for
// cannot come apart.
//
// **And a `static` accessor is named by hand**, in `static_setter_place`, which is
// exactly the hole `lower_static_call` was for a method: that one shipped as a wrong
// answer and was found by a peer, so this one is closed in the commit that creates it.
//
// `tooling/gate/example-refusals` carries the one refusal, and
// `compiler/core/tests/an_accessor_crosses_a_try.rs` asserts the copies by name.

class Box {
  private stored: number;
  constructor(value: number) {
    this.stored = value;
  }
  get doubled(): number {
    if (this.stored > 3) {
      throw new RangeError("too big");
    }
    return this.stored * 2;
  }
  get checked(): number {
    return this.stored;
  }
  set checked(next: number) {
    if (next > 3) {
      throw new RangeError("too big");
    }
    this.stored = next;
  }
  get plain(): number {
    return this.stored;
  }
}

class Statics {
  private static held = 0;
  static get guarded(): number {
    if (Statics.held > 3) {
      throw new RangeError("too big");
    }
    return Statics.held * 2;
  }
  static set guarded(next: number) {
    if (next > 3) {
      throw new RangeError("too big");
    }
    Statics.held = next;
  }
}

class Base {
  get overridden(): number {
    throw new RangeError("base");
  }
}
class Derived extends Base {
  override get overridden(): number {
    return 1;
  }
}
const pair: Base[] = [new Base(), new Derived()];

export function readingAGetter(n: number): number {
  const box = new Box(n & 7);
  try {
    return box.doubled;
  } catch {
    return -1;
  }
}

export function writingASetter(n: number): number {
  const box = new Box(0);
  try {
    box.checked = n & 7;
    return box.plain;
  } catch {
    return -1;
  }
}

export function compoundThroughAnAccessor(n: number): number {
  const box = new Box(1);
  try {
    box.checked += n & 7;
    return box.plain;
  } catch {
    return -1;
  }
}

export function aStaticAccessor(n: number): number {
  try {
    Statics.guarded = n & 7;
    return Statics.guarded;
  } catch {
    return -1;
  }
}

/**
 * The **fallback** half of the override slot: `Derived`'s getter cannot raise, so it
 * gets no copy and its slot holds its *ordinary* entry.
 *
 * `0` reads the base, which always throws, and `1` reads the override, which answers
 * `1` -- so a compiler that resolved the override's raising slot **up** to
 * `Base#get overridden@raises` (the JVM lane's `SHADOWED`: a class running its
 * ancestor's body with a happy verifier and no `NoSuchMethodError`) would answer `-1`
 * on the odd cases and this arm would say so. Asserted as an answer, because the wrong
 * dispatch here produces a plausible number rather than a diagnostic.
 */
export function anOverriddenGetter(n: number): number {
  try {
    return pair[n & 1]!.overridden;
  } catch {
    return -1;
  }
}

/**
 * The **copy** half: an override that *can* raise gets a copy of its own, named at the
 * same slot. Both bodies are reachable through one dispatch and both can throw, which
 * is what the base's copy alone cannot pin.
 *
 * `bound` is set before the `try` so each case takes a different path through the
 * override: `2` and `6` answer, `5` and `7` throw, and the base throws always.
 */
class Counting extends Base {
  bound = 0;
  override get overridden(): number {
    if (this.bound > 3) {
      throw new RangeError("counting is too deep");
    }
    return this.bound * 2;
  }
}
const counting = new Counting();
const both: Base[] = [new Base(), counting];

export function anOverrideThatAlsoThrows(n: number): number {
  counting.bound = n & 7;
  try {
    return both[n & 1]!.overridden;
  } catch {
    return -1;
  }
}

/** The control: a getter that cannot throw, read inside a `try`. */
export function aQuietGetter(n: number): number {
  const box = new Box(n & 7);
  try {
    return box.plain;
  } catch {
    return -1;
  }
}
