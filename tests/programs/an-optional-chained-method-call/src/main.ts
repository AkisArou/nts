// `a?.b()` -- an optional chain whose next step is a method call.
//
// Row 111 of the ledger names `?.`, `?.()` and `?.[]` together and was marked
// green; this one refused. `lower_method_call` destructured its callee as
// `[receiver, member]`, and an optional-chained member access has **three**
// children because the `?.` is a token of its own between them, so the shape
// fell through to a refusal. Measured before building: 76 distinct source
// sites across 24 files in `runtime/node`, and **zero** of them carry a second
// `?.`, so none is the separately refused `a link after an optional access`.
//
// The neighbouring spelling `a.b?.()` -- a function-valued property called
// optionally -- is a different node and was already green. It is the control
// at the bottom, and it must not have moved.

const identity = (v: number): number => v;
class Real { step(v: number): number { return v + 1 } }
class Holder { t: Real | null = null }

/** Under test: `a?.b()` with the receiver absent -- must not call, must give undefined. */
export function absent(n: number): number {
  const h = new Holder();
  return h.t?.step(n & 3) ?? 100;
}

/** Under test: the same call with the receiver present. */
export function present(n: number): number {
  const h = new Holder();
  h.t = new Real();
  return h.t?.step(n & 3) ?? 100;
}

/** Under test: the argument must not be evaluated when the receiver is absent. */
let calls = 0;
function counted(v: number): number { calls += 1; return v }
export function argumentsAreLazy(n: number): number {
  calls = 0;
  const h = new Holder();
  const a = h.t?.step(counted(n & 3)) ?? 100;
  const b = calls;
  h.t = new Real();
  const c = h.t?.step(counted(n & 3)) ?? 100;
  return a * 1000 + b * 100 + c * 10 + calls;
}

/** Control: the neighbouring spelling, already green. */
interface WithFn { step: ((v: number) => number) | undefined }
export function propertyCall(n: number): number {
  const w: WithFn = { step: undefined };
  return w.step?.(identity(n & 3)) ?? 200;
}
