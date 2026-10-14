// `function f() { class L { … } … }`.
//
// It was refused as `a class declaration is not supported by this lowering yet`
// — the generic fallthrough for a statement kind nothing handled — and the whole
// enclosing function went with it.
//
// Nothing had to be built. The driver walks **every** `CLASS_DECLARATION` node
// wherever it sits, so the layout and the members were already lowered, and
// `new L()` resolves through the checker's type rather than through a binding.
// The statement declares no value, which is the same reason
// `bind_nested_function` answers `Ok(())` for a function nothing captures.
//
// **What is not answered, and should not be:** a method that reads an enclosing
// local. The member is lowered by a builder with no enclosing bindings, so it
// refuses inside the method and names the name —
//
//     class L { read(): number { return n; } }
//     ^ `n`, a name from an enclosing scope is not supported by this lowering yet
//
// — which is the honest place for it. A class that closes over its scope is the
// closure machinery's question, not this statement's.

/** A field only, which is the smallest thing a local class can be. */
export function field(n: number): number {
  class L {
    v = 4;
  }
  return new L().v + n;
}

/** With a method, so the member lowering is exercised through this path too. */
export function method(n: number): number {
  class L {
    v = 4;
    twice(): number {
      return this.v * 2;
    }
  }
  return new L().twice() + n;
}

class Base {
  v = 1;
  describe(): number {
    return this.v * 10;
  }
}

/** Extending a top-level class, so the base lookup crosses the function. */
export function derived(n: number): number {
  class L extends Base {
    override v = 9;
  }
  return new L().describe() + n;
}

/** Two in one function, answering differently so a layout shared between them
 *  would show in the value rather than only in a count. */
export function twoInOneFunction(n: number): number {
  class A {
    v = 1;
  }
  class B {
    v = 2;
  }
  return new A().v * 100 + new B().v + n;
}
