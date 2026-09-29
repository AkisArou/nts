// invalid HIR: `MixedOperands { op: "==", left: Bool, right: Float }`.
// JavaScript's `==` across types converts first (IsLooselyEqual: a boolean
// becomes a number), and the lowering emits the two representations as they
// are, which the verifier refuses. The checker calls it unintentional
// (TS2367); JavaScript does not, and test262 has it: expressions/equals/
// S11.9.1_A3.2.js and its does-not-equals, compound-assignment kin -- 34
// files in test/language at e32be23f8. Siblings: a string and a number (C
// that does not compile), a bigint and a number. The control,
// loose-equality-after-an-explicit-conversion, converts first and agrees.
// @ts-expect-error -- a boolean and a number are loosely equal in JavaScript
observe("true == 1", String(true == 1));
done();
