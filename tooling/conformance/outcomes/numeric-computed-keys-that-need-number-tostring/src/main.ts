// Numeric computed keys whose property name needs ECMAScript's Number::toString,
// where Rust's f64 formatting and JavaScript's part:
//
//   [1e21]      "1e+21"      JS switches to exponent form at 1e21; Rust prints digits
//   [123e-20]   "1.23e-18"   normalised mantissa
//
// There was no Rust Number::toString in the tree (the runtime's is C, reached only
// at run time), so the compiler could not produce these names; the compiler lane is
// writing one (ECMAScript 7.1.12.1). What this records is what the binary *does*,
// measured -- today both reads vanish -- and it is re-recorded from what the
// implementation actually gives, never from what it was expected to give. `[1e-7]`, whose
// spelling is its name, is guarded on its own (a-numeric-key-whose-spelling-is-its-name):
// here a refusal of it would pass as REFUSES NOW and hide the regression.
const o = {
  [1e21]() { return "1e21"; },
  [123e-20]() { return "123e-20"; },
};
observe("1e+21", o["1e+21"]());
observe("1.23e-18", o["1.23e-18"]());
observe("after", "reached");
done();
