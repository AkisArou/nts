// The control for a-number-times-an-empty-object, differing in the operand:
// the value `{}` converts to (NaN) given directly, where the defect gives the
// object. Agrees with node. (`Number({})` would be the conversion written out,
// and is itself refused -- "a conversion to number from this type".)
const product = 1 * Number.NaN;
observe("1 * NaN is NaN", String(Number.isNaN(product)));
done();
