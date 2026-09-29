// invalid HIR: `MixedOperands { op: "==", left: BigInt, right: Float }`.
// `1n == 1` is true in JavaScript -- IsLooselyEqual compares a bigint and a
// number by mathematical value -- and the lowering emits the two
// representations as they are. 12 files in test/language at e32be23f8.
// @ts-expect-error -- a bigint and a number are loosely equal in JavaScript
observe("1n == 1", String(1n == 1));
done();
