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

class Holder {
  #list: number;
  constructor(n: number) {
    this.#list = n;
  }
  static brands(value: unknown): boolean {
    return value !== null && typeof value === "object" && #list in value;
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
