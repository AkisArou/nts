// A wrong answer, silent: `1 * {}` is NaN -- `*` converts the object
// (ToNumber, through ToPrimitive: `{}` has no numeric valueOf, so its string
// "[object Object]", which is NaN). nts compiles it and answers a number. The
// control, a-number-times-the-value-an-object-converts-to, multiplies by NaN
// itself and agrees. The wrong value is the object's pointer read as a double.
//
// Found measuring the compiler lane's slice 0 (`any` as Erased), under which
// test262's asi/S7.9_A10_T1, T3 and T5 -- `1 * {}` and `({}) * 1` as bare
// statements -- went from pass to refused: they had passed because the
// wrong value was never read (2026-09-30). With a `valueOf` the same shape is
// invalid HIR (OperandsDiffer), loose-equality-of-a-*'s family.
// @ts-expect-error -- an object is converted to a number by `*`
const product = 1 * {};
// A pointer read as a double differs run to run; whether it is NaN does not.
observe("1 * {} is NaN", String(Number.isNaN(product)));
done();
