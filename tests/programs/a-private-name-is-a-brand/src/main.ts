// `#field in value` -- the brand check, which is how a class recognises its own
// instances when a method has been detached.
//
//     static #brandCheck(value: unknown): asserts value is URLSearchParams {
//       if (value === null || typeof value !== "object" || !(#list in value))
//         throw new ERR_INVALID_THIS("URLSearchParams");
//     }
//
// A private name cannot be computed and cannot be forged, so the set of classes
// declaring it is known at compile time and the test is an instance test.
//
// # The other spelling, which is not the same question
//
// `"#list" in value` is a **string** key that happens to be spelled with a `#`,
// and a `#private` member is not a string-keyed property — node answers `false`.
// This compiler answered `true`: `declares` matched on the property's *name*,
// and `class C { #m }` and `{ "#m": 1 }` both produce a property named `"#m"`.
// A wrong answer that compiled and ran, in the row the census cannot rank.
//
// Rejecting any key beginning with `#` would be wrong in the other direction:
// `{ "#m": 1 }` is a legal object and `"#m" in it` is `true`. The question is
// about the *property*, not the key, so it is asked of the declaration — the
// same test `enumerable_fields` already makes so that `Object.keys` leaves
// `#private` members out.

class Holder {
  #list: number;
  constructor(n: number) {
    this.#list = n;
  }
  static brands(value: unknown): boolean {
    return value !== null && typeof value === "object" && #list in value;
  }

  /**
   * The same check written against `this`, which is how `URLSearchParams`'s
   * inspect method and its iterator's `next` write it.
   *
   * Inside a class body `this` is a **type parameter**, not the class, so this
   * spelling asked whether a parameter is an object and refused with "an `in`
   * on something that is not an object, which JavaScript throws for" -- a
   * sentence about a receiver that is provably an object, said of a type
   * variable. Resolving the parameter to its constraint is what the call path
   * already does for `this`-typed generics.
   *
   * One idiom, two spellings, and only the spelling decided whether it lowered.
   */
  brandsThis(): boolean {
    return this !== null && typeof this === "object" && #list in this;
  }
}

/**
 * **The soundness case.** A second class declaring a private name spelled the
 * same way. `#list` here and `#list` in `Holder` are *different names* -- the
 * language scopes a private name to the class body that declares it -- so
 * `Holder.brands(new Decoy())` must be `false`.
 *
 * A test that matched declaring classes by name alone would find both and
 * answer `true`, and every brand check in the tree would accept the wrong
 * receiver. That is the whole reason this fixture exists.
 */
class Decoy {
  #list: number;
  // Deliberately a different shape from `Holder`.
  //
  // Two classes whose fields match exactly share one layout and therefore one
  // descriptor, and `instanceof` compares descriptors -- so with `Decoy` an
  // exact twin of `Holder` this fixture fails for a reason that has nothing to
  // do with private names. That is a real defect and it is filed as
  // `blockers/two-classes-one-descriptor`; keeping it out of this file is what
  // lets this one test the thing it is named for.
  tag: string;
  constructor(n: number) {
    this.#list = n;
    this.tag = "decoy";
  }
  static brands(value: unknown): boolean {
    return value !== null && typeof value === "object" && #list in value;
  }
}

class Derived extends Holder {}

class Unrelated {
  other = 1;
}

/**
 * The string spelling of a private name, which no object has as a key.
 *
 * `false` for both the declaring class and a stranger: this is not a brand check
 * at all, and reading it as one is what made it answer `true`.
 */
export function theStringSpellingIsNotTheBrand(n: number): number {
  const held = new Holder(n);
  const mine = "#list" in held ? 1 : 0;
  const theirs = "#list" in new Decoy(n) ? 1 : 0;
  return mine * 10 + theirs;
}

/**
 * The control in the other direction: a string key that really is spelled `#`.
 *
 * `{ "#list": 1 }` has that key and `in` must say so. A fix that rejected every
 * key beginning with `#` would answer 0 here, and this is the arm that catches
 * it.
 */
export function aStringKeySpelledWithAHash(n: number): number {
  const table: Record<string, number> = { "#list": n };
  return "#list" in table ? 1 : 0;
}

export function ownInstance(n: number): boolean {
  return Holder.brands(new Holder(n));
}

/** Must be false: a different class, a different `#list`. */
export function decoyIsNotHolder(n: number): boolean {
  return Holder.brands(new Decoy(n));
}

/** And the other direction. */
export function holderIsNotDecoy(n: number): boolean {
  return Decoy.brands(new Holder(n));
}

/** A subclass carries the base's private field. */
export function subclassIsHolder(n: number): boolean {
  return Holder.brands(new Derived(n));
}

export function unrelatedIsNot(n: number): boolean {
  return Holder.brands(new Unrelated()) || n < 0;
}

/**
 * The `this` spelling, on an instance that has the field.
 *
 * The *false* direction is not reachable from TypeScript without detaching the
 * method -- `f.call(decoy)` -- and `Function.prototype.call` with an explicit
 * receiver is refused and filed. So the negative is carried by the parameter
 * form above, which tests the same `declares` path with the same key.
 */
export function thisFormOnItsOwnInstance(n: number): boolean {
  return new Holder(n).brandsThis();
}

/** And through a subclass, where `this` is the derived class. */
export function thisFormOnASubclass(n: number): boolean {
  return new Derived(n).brandsThis();
}
