// expect: differential walk disagrees
//
// A declared *literal* numeric type is trusted by the body and not enforced at
// the entry, so a caller outside TypeScript gets a wrong number rather than an
// error.
//
//     export function walk(rounds: 64): number
//
//     nts   walk(2147483647) = 1073742848
//     node  walk(2147483647) = 2305843005992468500
//
// The compiler is entitled to the fact. `rounds: 64` is a promise about every
// caller, and `flow.rs` says so where it seeds a parameter: "its declared type
// -- `0 | 1 | 2` is a fact about every possible caller, available without
// seeing one." Trusting it is the basis of specialization and is not the defect.
//
// The defect is that the promise is not checked anywhere a *non*-TypeScript
// caller crosses. Three facts together:
//
//   1. The parameter's facts are `[64, 64]`, which `nts facts` prints.
//   2. The emitted signature stays `f64`, because an exported function is a
//      root and a root is a wall -- so the napi wrapper takes a `double`.
//   3. The integer body `walk#whole` is entered on a guard that asks only
//      whether the argument is a whole `int32`:
//
//          %13 = toint32 %0 : i32
//          %16 = convert %13 : f64
//          %14 = eq %16, %0 : bool        <- integrality, not `== 64`
//          br %14, b6, b5
//
// So `2147483647` passes a guard meant to select the integer path and lands in
// a body whose accumulator was proven small from `[64, 64]`. It wraps.
//
// `numeric_guard` in the napi wrapper validates by `HirType` -- the int widths
// -- and the type here is `f64`, so nothing rejects the argument. From
// JavaScript this is silent: a number comes back and it is wrong.
//
// **The control is the same program with the literal removed.** With
// `rounds: number` the accumulator stays wide and every pool value agrees, so
// this is the literal being trusted rather than an overflow in the integer
// path: `sumBounded` below sums past `2^31` with a plain `number` parameter and
// is correct.
//
// Two ways to close it and they are not equivalent, which is why this is filed
// rather than fixed:
//
//   - the wrapper enforces the declared facts, so a caller that breaks the
//     promise gets a `TypeError` -- which is what a boundary is for, and what
//     `numeric_guard` already does for `int32`;
//   - or the analysis stops trusting a declared fact for a *root's* parameters,
//     consistent with "a root is a wall" -- which costs the optimisation on
//     every exported function.
//
// The first keeps the optimisation and needs the wrapper to see facts it is not
// currently given; `param.known` is `TOP` for a root by the time the backend
// runs. The second is smaller and gives up real speed on the whole public
// surface.

export function walk(rounds: 64): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total = total + i;
  }
  return total;
}

// Control: the same shape with no literal. Sums well past `2^31` and agrees on
// every pool value, so the integer path is not itself broken.
export function sumBounded(n: number): number {
  const bound = n > 100000 ? 100000 : n;
  let total = 0;
  let i = 0;
  while (i < bound) {
    total = total + i;
    i = i + 1;
  }
  return total;
}
