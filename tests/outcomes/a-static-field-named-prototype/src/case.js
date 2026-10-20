// backend: jvm
// run: check
//
// A static field named `prototype`: two globals in the prepared program,
// one name. The class's own prototype global and the user's static field
// are both `C.prototype`, and core puts the prototype's object type and
// the user's initializer 42 in one slot:
//
//   global 0: "C.prototype" ty=Managed(Object(...)) initial=42
//   global 1: "C.prototype1" ty=Managed(Object(...)) initial=0
//
// An initial value that does not inhabit its global's type. The JVM
// writes it faithfully (bipush 42 into a field of type C) and the
// verifier refuses the whole Program class at load, before any case
// runs. The spec's answer is a TypeError at class evaluation --
// DefineField on the constructor's non-writable, non-configurable
// `prototype` -- which node gives, catchably, inside `answer`. On C
// the same global is a pointer written with 42 and never read here.
//
// The control is `control`: the same class with the field named
// `proto`, whose value reads back.
//
// **Since 2026-10-20 the class throws that TypeError**, while it is
// defined and before any static initializer runs, and the field has no
// global. The record is a guard now -- both functions agreeing on the
// JVM -- and a change that gives the field storage again shows here as
// the VerifyError. tests/programs/a-static-member-named-prototype-throws
// holds the method, accessor and ordering arms on every backend.
//
// Typed TypeScript cannot spell this (TS2699), so the case is JS.
// Found by test262 statement class elements
// fields-computed-name-static-propname-prototype (2026-10-19 census),
// where it was the JVM language slice's one VerifyError.

/** @param {number} n @returns {number} */
export function answer(n) {
  try {
    const C = class {
      static ["prototype"] = 42;
    };
    return 1 + (n & 0) + (C === C ? 0 : 0);
  } catch (e) {
    return e instanceof TypeError ? 2 : 3;
  }
}

/** @param {number} n @returns {number} */
export function control(n) {
  const D = class {
    static ["proto"] = 42;
  };
  return D["proto"] + (n & 0);
}
