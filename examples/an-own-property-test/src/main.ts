// `o.hasOwnProperty(k)`, answered from the layout.
//
// **It is `in` minus everything inherited**, which is the whole of the
// difference and the reason it cannot reuse `lower_in`. `in` walks the prototype
// chain — `"valueOf" in {}` is true, and `lower_in` carries the list of
// `Object.prototype`'s names for it — while `hasOwnProperty` asks only about the
// object's own storage. So a *method* answers `false`: `class C { m() {} }` puts
// `m` on the prototype, and `new C().hasOwnProperty("m")` is false in every
// engine.
//
//     a `Field` the type declares      true
//     a `Method` or an `Accessor`      false — on the prototype, not the object
//     no property of that name         false
//     an optional field                refused; the answer is a presence bit
//
// A `#private` member answers `false` through the same test `declares` makes for
// `"#m" in o` and `enumerable_fields` makes for `Object.keys`: it is not a
// string-keyed property, and the snapshot spells it as though it were.
//
// # The three kinds, and where the line is
//
// `class C { #m; ["#m"] = 0 }` is legal and declares *two* members. The checker
// records two properties with one name and different declarations, and which of
// the three kinds the private one is decides what this compiler can do:
//
//     #m = 44       a Field     two slots wanted, one exists      refused
//     get #m()      an Accessor `this.#m` took the slot           refused
//     #m() {}       a Method    held by the dispatch table        fine
//
// The method case **passes**, and it is excluded from the refusal for that
// reason. Refusing all three was measured first and cost that file — which is
// how the line was found rather than guessed.
//
// The two refusals replace *wrong answers*: `this.#m` read the computed slot,
// 4 where node reads 44, on this binary and on 23666c14 alike. Giving them two
// slots needs a name a `#private` member can be addressed by and a string key
// cannot — a mangling through the layout, both field paths and all three
// backends — so a refusal naming the collision is the direction to trade in.

class Holder {
  count = 1;
  #secret = 2;

  reach(): number {
    return this.#secret;
  }

  method(): number {
    return 3;
  }
}

/** A declared field is own storage. */
export function aFieldIsOwn(n: number): number {
  return (new Holder().hasOwnProperty("count") ? 1 : 0) + n * 0;
}

/** A method is on the prototype, so it is not. */
export function aMethodIsNotOwn(n: number): number {
  return (new Holder().hasOwnProperty("method") ? 1 : 0) + n * 0;
}

/** A name nothing declares. */
export function anAbsentNameIsNotOwn(n: number): number {
  return (new Holder().hasOwnProperty("nothing") ? 1 : 0) + n * 0;
}

/**
 * An inherited name from `Object.prototype`, which `in` answers true for.
 *
 * This is the arm that separates the two operators: a fix that reused `in`
 * wholesale would answer 1 here.
 */
export function aPrototypeNameIsNotOwn(n: number): number {
  return (new Holder().hasOwnProperty("valueOf") ? 1 : 0) + n * 0;
}

/** A `#private` member is not a string-keyed property, so it is not own. */
export function aPrivateNameIsNotOwn(n: number): number {
  const held = new Holder();
  return (held.hasOwnProperty("#secret") ? 1 : 0) * 10 + held.reach() + n * 0;
}

/**
 * The control that the receiver is still evaluated.
 *
 * The answer is a constant and the call that produced the object is not. A fold
 * that replaced the whole expression would answer 1 here instead of 11.
 */
export function theReceiverStillRuns(n: number): number {
  let calls = 0;
  const make = (): Holder => {
    calls = calls + 1;
    return new Holder();
  };
  const answer = make().hasOwnProperty("count") ? 1 : 0;
  return calls * 10 + answer + n * 0;
}

/**
 * A private **method** beside a computed key of the same name, which works.
 *
 * The method is held by the dispatch table and the computed key has the slot,
 * so all three answers are separable. This is the arm that fails if the
 * collision refusal is ever widened to cover methods.
 */
class Both {
  #m(): number {
    return 7;
  }

  ["#m"] = 0;

  all(): number {
    return (this.hasOwnProperty("#m") ? 1 : 0) * 100 + this["#m"] * 10 + this.#m();
  }
}

export function aPrivateMethodBesideAComputedKey(n: number): number {
  return new Both().all() + n * 0;
}
