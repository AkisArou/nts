// A class declared in a function is a fresh class each time the function
// runs, with fresh static storage: two calls give two classes, each with
// its own `x`, initialized anew. Here a function-local class -- a
// declaration or a class expression alike -- has one static storage for
// the whole program, initialized once and never again, so every class the
// function makes shares one `x`. Two live instances step one counter:
// node: 11 (each `inc` sees its own class's 0 -> 1); nts: 12 at the least,
// and more in every later case, since nothing ever resets it.
//
// The control is `moduleClass`: the same class at module scope, evaluated
// once in both, where one storage is the language's answer and agrees.
//
// Found while making a class expression evaluate its static elements
// (2026-10-20). That fix runs a static block or a non-constant initializer
// once per evaluation, as node does; the storage it writes is still this
// one. A fresh class per evaluation is a representation question, not a
// lowering one. JS, to match its siblings; TypeScript spells it the same.

class M {
  static x = 0;
  inc() {
    M.x = M.x + 1;
    return M.x;
  }
}

function makeDeclared() {
  class C {
    static x = 0;
    inc() {
      C.x = C.x + 1;
      return C.x;
    }
  }
  return new C();
}

function makeExpressed() {
  const C = class {
    static x = 0;
    inc() {
      C.x = C.x + 1;
      return C.x;
    }
  };
  return new C();
}

/** @param {number} n @returns {number} */
export function declared(n) {
  const a = makeDeclared();
  const b = makeDeclared();
  return a.inc() * 10 + b.inc() + (n & 0);
}

/** @param {number} n @returns {number} */
export function expressed(n) {
  const a = makeExpressed();
  const b = makeExpressed();
  return a.inc() * 10 + b.inc() + (n & 0);
}

/** @param {number} n @returns {number} */
export function moduleClass(n) {
  const a = new M();
  const b = new M();
  return a.inc() * 10 + b.inc() + (n & 0);
}
