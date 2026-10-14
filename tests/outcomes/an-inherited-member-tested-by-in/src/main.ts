// `"valueOf" in {}` is true: `in` walks the prototype chain, and valueOf is
// Object.prototype's. nts answers false for an object whose type is `{}`.
// Found by test262's expressions/in/S8.12.6_A2_T1.js. The control declares
// the object as a record with an optional member and differs in the type
// only; it answers true.
var empty = {};
var typed: { own?: number } = {};
observe("empty", String("valueOf" in empty));
observe("typed", String("valueOf" in typed));
done();
