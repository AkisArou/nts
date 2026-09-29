// `emit-c` exits 0 and `cc` rejects the C: `"1" == 1` -- JavaScript's `==`
// converts the string to a number first (IsLooselyEqual) -- reaches the C
// backend as a comparison of a string with a double. The verifier passes it,
// which is why this one is C rather than invalid HIR: its sibling
// loose-equality-of-a-boolean-and-a-number is refused by `MixedOperands`.
// test262's OperandsDiffer rows (String/Float, 16 files in test/language at
// e32be23f8) are the same comparison where the verifier does catch it.
// @ts-expect-error -- a string and a number are loosely equal in JavaScript
observe("\"1\" == 1", String("1" == 1));
done();
