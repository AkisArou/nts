// expect: `n`, a name from an enclosing scope
//
// A class declared inside a function lowers -- see
// `examples/a-class-declared-inside-a-function` -- because the driver walks
// every `CLASS_DECLARATION` wherever it sits and the statement declares no
// value. What that does **not** answer is a member that reads an enclosing
// local.
//
// The member is lowered by a builder with no enclosing bindings, so it refuses
// inside the method and names the name. That is the honest place for it: a
// class that closes over its scope needs the capture machinery an arrow has,
// and a class has no object to put the captures in -- its instances are the
// user's, one per `new`, while a closure's environment is one per *creation of
// the closure*. The two are different objects with different lifetimes.
//
// Kept as a fixture so the refusal stays this one. Before the statement was
// answered, the whole enclosing function refused with `a class declaration is
// not supported by this lowering yet` and this program was indistinguishable
// from one that merely declared a class.

export function f(n: number): number {
  class L {
    read(): number {
      return n;
    }
  }
  return new L().read();
}
