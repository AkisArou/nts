// invalid HIR: `MixedOperands { func: "module#init", op: "==", left: Bool,
// right: Float { bits: 64 } }`. `Object.is` given a boolean and a number
// lowers to an `==` of the two representations as they are, which the
// verifier refuses, so `emit-c` writes nothing for the whole program. Found
// by test262's Object/is/not-same-value-x-y-boolean.js and
// not-same-value-x-y-type.js. `examples/object-is` never mixes the types.
//
// Controls, each measured as compiling: `Object.is(true, false)` and
// `Object.is(0, 1)`. Not arms here because invalid HIR costs the whole program.
observe("true vs 1", String(Object.is(true, 1)));
done();
