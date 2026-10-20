// A class expression, `const C = class { … }`, evaluates its static fields
// and blocks where it is evaluated, in source order -- exactly as a class
// declaration does.
//
// It evaluated **nothing**: the binding has no storage (the class resolves
// through the checker's type), so both sites that lower one -- a local
// declaration and a module-scope one -- skipped it, and nothing else lowers a
// class expression. Silently, on every backend:
//
//     const E = class { static { bump(); } };   // node: bump runs.  this: no
//
// `declaredInAFunction` is the control: the same class as a declaration,
// which agreed throughout. `evaluatedTwice` is the one the per-evaluation
// semantics shows in: a class expression evaluated twice runs its static
// block twice. The storage its fields write is still one per class -- see
// tests/outcomes/a-function-local-class-keeps-one-static-storage.

let bumped = 0;

function bump(): number {
  bumped = bumped + 1;
  return bumped;
}

const AtModule = class {
  static first = bump() * 10;
  static {
    bump();
  }
  static third = bump() * 100;
};

const bumpedByModule = bumped;

/** Both module-scope fields and the block between them ran, in order. */
export function atModuleScope(n: number): number {
  return bumpedByModule * 1000 + AtModule.first + AtModule.third + n * 0;
}

export function fieldInAFunction(n: number): number {
  bumped = 0;
  const E = class {
    static x = bump();
  };
  return bumped + n * 0;
}

export function blockInAFunction(n: number): number {
  bumped = 0;
  const E = class {
    static {
      bump();
    }
  };
  return bumped + n * 0;
}

function makeOne(): number {
  const E = class {
    static {
      bump();
    }
  };
  return 0;
}

export function evaluatedTwice(n: number): number {
  bumped = 0;
  return makeOne() + makeOne() + bumped + n * 0;
}

export function declaredInAFunction(n: number): number {
  bumped = 0;
  class D {
    static x = bump();
    static {
      bump();
    }
  }
  return bumped + n * 0;
}
