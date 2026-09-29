// expect: NTS1001 a conversion to number from this type
//
// `Math.max(1, obj)`: the specification converts **every** argument with
// ToNumber, and an object's ToNumber is ToPrimitive -- it runs `valueOf` and
// `toString` off a prototype chain, which nothing in a compiled program does yet.
// So this refuses, by the same sentence `Number(obj)` refuses with.
//
// **It was `outcomes/math-max-converts-every-argument`, category `invalid-hir`.**
// The fold pushed a `Binary` over a `Float` and a `Managed(Object)` and reached
// the verifier as `OperandsDiffer` -- and that record's header had already noticed
// what made it wrong: `Number(obj)` was *refused* with this exact text while this
// compiled. One decision answered two ways. `coerce_to_number` is now applied per
// argument, so the two agree.
//
// Its sibling `math-max-with-a-nan-and-an-object` is the same cause wearing the
// other category, and the two moved together.
//
// **The refusal is the honest answer and not the finished one.** The day
// `nts_value_to_number` grows its reference arm this compiles and the fixture
// becomes an `outcomes` guard -- the plan names that item beside
// `an-object-incremented`, which needs the same arm.
//
// **Control, and it is the half that matters:** `ofNumber` passes a number where
// the object was and must keep compiling. A rule that refused every `Math.max`
// would satisfy the expectation above and break every numeric one.
//
// Found by test262's `Math/max/Math.max_each-element-coerced.js`.

const obj = { valueOf() { return 2; } };

export function ofObject(): number {
  // @ts-expect-error -- JavaScript: Math.max converts any argument
  return Math.max(1, obj);
}

export function ofNumber(): number {
  return Math.max(1, 2);
}
