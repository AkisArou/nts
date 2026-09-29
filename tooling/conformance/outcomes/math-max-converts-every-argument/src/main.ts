// invalid HIR: `OperandsDiffer { op: "Math.max", left: Float, right: Managed
// (Object) }`. Math.max converts every argument with ToNumber, and an object
// argument reaches the operation unconverted. The explicit conversion,
// `Number(obj)`, is refused ("a conversion to number from this type"); after
// a NaN the same call compiles and drops the conversion (outcomes/math-max-
// with-a-nan-and-an-object). Found by test262's Math/max/Math.max_each-
// element-coerced.js. The control passes a number where the object was.
let calls = 0;
const obj = { valueOf() { calls++; return 2; } };
// @ts-expect-error -- JavaScript: Math.max converts any argument
const ofObject = Math.max(1, obj);
const ofNumber = Math.max(1, 2);
observe("calls", String(calls));
observe("ofObject", String(ofObject));
observe("ofNumber", String(ofNumber));
done();
