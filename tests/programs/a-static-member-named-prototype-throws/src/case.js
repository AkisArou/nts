// A class with a static member named `prototype` cannot be defined: the
// constructor's own `prototype` is neither writable nor configurable, so
// node throws `TypeError: Classes may not have a static property named
// 'prototype'` while defining the class -- for a field, a method or an
// accessor alike, and before any static initializer or block runs.
//
// A field so named shared a global with the class's own prototype, holding
// 42 in a slot typed as the prototype object (the JVM's verifier refused
// the program at load); a method or accessor so named was defined. Neither
// threw. Each arm catches the TypeError and answers 2.
//
// `earlierInitializer` is the order: a static field before the prototype
// one is never initialized, so `bump` is not called. `calledInATry` throws
// from a function a `try` calls, which needs that function's raising copy.
// `constantKey` is the control: the same class with the field named
// `proto`, whose value reads back.
//
// Only a computed key spells it -- `static prototype` is an early error --
// and typed TypeScript refuses that too (TS2699), so the case is JS.

let bumped = 0;

function bump() {
  bumped = bumped + 1;
  return bumped;
}

/** @param {unknown} e @returns {number} */
function kind(e) {
  return e instanceof TypeError ? 2 : 3;
}

/** @param {number} n @returns {number} */
export function field(n) {
  try {
    class C {
      static ["prototype"] = 42;
    }
    return 1 + (n & 0);
  } catch (e) {
    return kind(e) + (n & 0);
  }
}

/** @param {number} n @returns {number} */
export function method(n) {
  try {
    class C {
      static ["prototype"]() {
        return 1;
      }
    }
    return 1 + (n & 0);
  } catch (e) {
    return kind(e) + (n & 0);
  }
}

/** @param {number} n @returns {number} */
export function getter(n) {
  try {
    class C {
      static get ["prototype"]() {
        return 1;
      }
    }
    return 1 + (n & 0);
  } catch (e) {
    return kind(e) + (n & 0);
  }
}

/** @param {number} n @returns {number} */
export function expressed(n) {
  try {
    const C = class {
      static ["prototype"] = 42;
    };
    return 1 + (n & 0);
  } catch (e) {
    return kind(e) + (n & 0);
  }
}

/** @param {number} n @returns {number} */
export function earlierInitializer(n) {
  bumped = 0;
  try {
    class C {
      static x = bump();
      static ["prototype"] = 42;
    }
    return 1 + (n & 0);
  } catch (e) {
    return kind(e) + bumped * 10 + (n & 0);
  }
}

function define() {
  class C {
    static ["prototype"]() {
      return 1;
    }
  }
  return 1;
}

/** @param {number} n @returns {number} */
export function calledInATry(n) {
  try {
    return define() + (n & 0);
  } catch (e) {
    return kind(e) + (n & 0);
  }
}

/** @param {number} n @returns {number} */
export function constantKey(n) {
  const D = class {
    static ["proto"] = 42;
  };
  return D["proto"] + (n & 0);
}
