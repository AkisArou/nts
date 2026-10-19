// **A `void` result written through a setter whose parameter nobody typed.**
// `set #field(value)` has no annotation, so the checker infers `value` from the
// getter: `boolean`. `doNotCall()` returns nothing, and that nothing reached the
// setter's `boolean` slot unchanged -- `coerce` passed a `void` value through
// every check, being neither managed nor erased -- so the verifier stopped the
// whole program: `CallArgumentType { func: "C#compoundAssignment", callee:
// "C#set #field", at: 1, expected: Bool, found: Void }`. Now it is refused by
// name, and the message says where the `boolean` came from, since the source
// never writes it.
//
// It is not about `||=`: `this.#field = doNotCall()` failed the same way.
// test262's logical assignments to a private accessor
// (`language/expressions/logical-assignment/left-hand-side-private-reference-accessor-property-*`)
// are this shape.
//
// Control, one difference: a right-hand side that returns `false` is a
// `boolean`, and the class compiles.

function doNotCall() {}

class C {
  get #field() {
    return true;
  }
  set #field(value) {}
  compoundAssignment() {
    return this.#field ||= doNotCall();
  }
}

/** @param {number} n @returns {number} */
export function subject(n) {
  return new C().compoundAssignment() ? n + 1 : n;
}
