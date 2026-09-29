// Math.max(NaN, obj) must still convert obj -- ToNumber calls its valueOf --
// and nts compiles the call and never calls it. The same object after a 1 is
// invalid HIR (outcomes/math-max-converts-every-argument), so the argument is
// not converted in either; after a NaN the verifier does not see it. Found by
// test262's Math/max/Math.max_each-element-coerced.js (and Math/min's twin).
// The control passes a call returning a number where the object was, and its
// call is kept.
let byObject = 0;
let byCall = 0;
const obj = { valueOf() { byObject++; return 2; } };
function call(): number { byCall++; return 2; }
// @ts-expect-error -- JavaScript: Math.max converts any argument
Math.max(NaN, obj);
Math.max(NaN, call());
observe("byObject", String(byObject));
observe("byCall", String(byCall));
done();
