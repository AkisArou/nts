// **Fixed 2026-10-15, and now its guard:** a class token stored into a module
// global reaches the global's type (63e6cc0d7). What it was:
//
// **A class stored into a module global gets no base, so the JVM cannot store it.**
// A class used as a value is an empty token (`Ctor_C`), and
// `relate_tokens_to_the_slot_they_reach` gives a token the layout of the one
// slot it is stored into as its base -- `typeof C` here, laid out as `Fn__3`
// -- so that a backend which types references can store it there. The pass
// notes a token stored into a field (`FieldSet`) and one passed to a direct
// call, and not one stored into a module global: `probe = C` is
// `global.set 0 = %0`. So `Ctor_C` has no base, and the JVM declines the
// store by name, "storing a `Ctor_C` where a `Fn__3` is declared". C stores
// the pointer and agrees with node.
//
// The control is `tests/programs/a-class-stored-into-an-object-field`, which
// differs in one thing: the slot is an object's field. Test262's
// `statements/class/static-init-scope-lex-derived` is this shape, from a static
// block.
//
// Found on 2026-10-15 by the JVM lane's first test262 parity run.

let probe;

class C {}

probe = C;

const same = probe === C;

/** @param {number} n @returns {number} */
export function probeIsTheClass(n) {
  return (same ? 1 : 0) + n;
}
