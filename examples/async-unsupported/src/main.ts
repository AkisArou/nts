// `async`, `await` and `Promise`, none of which the lowering implements.
//
// Two of the three are already refused correctly. The first one is not, and
// that is why this fixture is separate from `examples/unsupported`: there, one
// refusal among many satisfies the test, and the case that produces *no*
// diagnostic hides behind the cases that do.
//
// `twice` currently lowers. `Promise<number>` becomes `void`, the multiply
// happens, and the result is converted to nothing:
//
//   export func twice(n: f64) -> void {
//     %2 = mul %0, %3 : f64
//     %4 = convert %2 : void    <- the return value, discarded
//     ret %4
//   }
//
// The SSA verifier accepts it. So a caller gets `undefined` where it asked for
// a number, with nothing said at compile time -- which is the failure mode
// `examples/unsupported` exists to prevent, arriving through the one door that
// file cannot watch.
//
// When async lands, move this to an `examples/async` that asserts answers
// rather than refusals.
export async function twice(n: number): Promise<number> {
  return n * 2;
}

// Refused correctly today: `this expression is not supported by this lowering
// yet`. Kept so that a change which fixes `twice` by accident, without
// implementing awaiting, still fails here.
async function inner(n: number): Promise<number> {
  return n + 1;
}

export async function outer(n: number): Promise<number> {
  return await inner(n);
}

// Refused correctly today: `a `new` of unrepresentable type`.
export function later(n: number): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(n);
  });
}
