// `class MyError extends Error { constructor(public code: number) { … } }`
//
// A **parameter property** on a subclass of a provided class. The field it
// declares is written in the constructor's parameter list, not in the class
// body, and that one level was the whole of the gap.
//
// A class descending from a provided one takes that class's fields rather than
// the checker's flattened view of them — `stack?` and `cause?` are in the
// flattened list and are not fields here — and keeps only the members it
// declares *itself*. The set of "declares itself" was built by walking the
// class's children for a property or a method declaration, which a parameter
// property is not: it hangs off the constructor, one level deeper.
//
// So the field was dropped, and reading it refused as ``a type that has no
// representation`` — for a `number`. A sentence about the type, for a field the
// compiler had removed, which is the same failure this repository already
// records for a function-typed property.
//
// The controls are the three shapes that did lower and say what the fix must
// not disturb: a plain field on an `Error` subclass, a parameter property on a
// class descending from a *user* class, and a plain constructor parameter —
// which declares nothing and must stay declaring nothing.
//
// # And the control found a second defect, older and worse
//
// `parameterPropertyOnAUserBase` was written to pass. It did not: `d.tag` read
// **0** where node says **1**, on the compiler from before any of this, because
//
//     class Base { tag = 1 }
//     class Derived extends Base { constructor() { super() } }
//
// ran none of `Base`'s field initialisers. `super()` resolved the constructor
// to run, found that nothing above *declared* one, and concluded there was
// nothing to run — which is true of a base with only methods and false of every
// base whose fields have defaults. A silent wrong answer on every backend.
//
// Two things hid it. A derived class with **no** constructor gets a synthesised
// one that walks the whole chain, so `class Derived extends Base {}` was right.
// And giving the base an explicit constructor makes the lookup succeed, so the
// obvious minimal reproduction does not reproduce. It needs a base with only
// initialisers *and* a derived class that writes a constructor.
//
// `baseDefaultsThroughSuper` and the two below it hold it, including the three
// level chain, where the middle class is the one with the constructor.

class TaggedError extends Error {
  attempts = 7;

  constructor(
    public code: number,
    private detail: number,
    readonly limit: number,
  ) {
    super("tagged");
  }

  /** The `private` one, reachable only from inside. */
  hidden(): number {
    return this.detail;
  }
}

/** The shape that refused: a `public` parameter property, read from outside. */
export function readsTheCode(n: number): number {
  return new TaggedError(n, 2, 3).code;
}

/** `private` and `readonly` are parameter properties too, and each is a
 *  different modifier reaching the same place. */
export function readsTheOthers(n: number): number {
  const e = new TaggedError(1, n, 5);
  return e.hidden() * 100 + e.limit;
}

/** The provided base's own field is still there beside the new ones, which is
 *  the arm that fails if the subclass's fields replaced the base's rather than
 *  following them. */
export function readsTheMessageToo(n: number): number {
  const e = new TaggedError(n, 2, 3);
  return e.message.length * 100 + e.code;
}

/** A plain field declared in the body, beside the parameter properties, so the
 *  two sources of fields are exercised on one class. */
export function readsTheBodyField(n: number): number {
  const e = new TaggedError(n, 2, 3);
  return e.attempts * 100 + e.code;
}

/** Thrown and caught, which is what an error subclass is for — and
 *  `instanceof` has to find the class through a layout that now has more
 *  fields than the base's. */
export function thrownAndCaught(n: number): number {
  try {
    throw new TaggedError(n, 2, 3);
  } catch (error) {
    return error instanceof TaggedError ? error.code : -1;
  }
}

class PlainError extends Error {
  code = 0;
}

/** Control: a plain field on an `Error` subclass, which lowered before. */
export function plainFieldOnAnError(n: number): number {
  const e = new PlainError();
  e.code = n;
  return e.code;
}

class Base {
  tag = 1;
}

class Derived extends Base {
  constructor(public code: number) {
    super();
  }
}

/** Control: the same parameter property on a class descending from a **user**
 *  class, which lowered before because that path keeps the flattened view. */
export function parameterPropertyOnAUserBase(n: number): number {
  const d = new Derived(n);
  return d.code * 10 + d.tag;
}

class QuietError extends Error {
  constructor(code: number) {
    super("quiet" + String(code));
  }
}

/** Control: a **plain** constructor parameter declares nothing, and must keep
 *  declaring nothing. A fix that marked every parameter as a member would give
 *  this class a field the source never wrote. */
export function plainParameterIsNotAField(n: number): number {
  return new QuietError(n).message.length;
}

class Defaults {
  tag = 1;
  scale = 2;
}

class WithAConstructor extends Defaults {
  constructor(public code: number) {
    super();
  }
}

/** The second defect: a base with **only** field initialisers, and a derived
 *  class that writes a constructor. Every one of `Defaults`'s fields was 0. */
export function baseDefaultsThroughSuper(n: number): number {
  const v = new WithAConstructor(n);
  return v.code * 100 + v.tag * 10 + v.scale;
}

class Top {
  a = 1;
}

class Middle extends Top {
  constructor() {
    super();
  }
}

class Bottom extends Middle {
  c = 3;
}

/** Three levels with the constructor in the **middle**, so the chain above the
 *  `super()` is longer than one. */
export function threeLevelsWithTheConstructorInTheMiddle(n: number): number {
  const v = new Bottom();
  return v.a * 10 + v.c + n * 0;
}

class Readable {
  x = 4;
}

class ReadsTheBase extends Readable {
  y = this.x + 10;

  constructor() {
    super();
  }
}

/** A derived initialiser reading what the base's initialiser stored, which is
 *  the arm that fails if the chain runs in the wrong order rather than not at
 *  all. */
export function derivedInitialiserReadsTheBase(n: number): number {
  return new ReadsTheBase().y + n * 0;
}

class Explicit {
  tag: number;

  constructor() {
    this.tag = 1;
  }
}

class BelowExplicit extends Explicit {
  constructor(public code: number) {
    super();
  }
}

/** Control: the same shape with the base declaring a **constructor**, which
 *  made the lookup succeed and hid the defect. It lowered before and must
 *  still. */
export function baseWithItsOwnConstructor(n: number): number {
  const v = new BelowExplicit(n);
  return v.code * 10 + v.tag;
}
