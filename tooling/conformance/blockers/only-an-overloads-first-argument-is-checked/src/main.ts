// expect: emit-c --napi -> calls (() => { const p = (f, ...a) => { try { f(...a); return "accepted"; } catch (e) { return "rejected"; } }; return [p(exports.required, "s"), p(exports.optional, "s"), p(exports.secondRequired, 1, "s"), p(exports.secondOptional, 1, "s"), p(exports.overloaded, 1, "s"), p(exports.threeOverloaded, "s", 2, 3), p(exports.threeOverloaded, 1, "s", 2), p(exports.threeOverloaded, 1, 2, "s")].join(",") === "rejected,rejected,rejected,rejected,rejected,rejected,rejected,rejected"; })()
// control: exports.required(1) === "number" && exports.optional(1) === "number" && exports.secondRequired(1, 2) === "number,number" && exports.overloaded(1, 2) === "number,number" && exports.viaOverload(1, 2) === "integer" && exports.viaOverloadLoose(1, 2) === "integer"
//
// **Kept as a guard. Fixed 2026-09-10, the same day it was filed.**
//
// An overloaded function's wrapper checked only its first argument. Every other
// shape's checked all of them, which is what made the trigger findable:
//
//     required("s")              threw
//     optional("s")              threw
//     secondRequired(1, "s")     threw
//     secondOptional(1, "s")     threw          second, optional, not overloaded
//     overloaded(1, "s")         "number,string" the string arrived, as a string
//     overloaded("s", 1)         threw           first argument still checked
//
// So neither "second" nor "optional" was the trigger; overloads were. The Node
// lane ruled the other two out by measuring them rather than by reasoning,
// which is why the report arrived with the cause already isolated.
//
// # The cause
//
// A symbol's declarations list the overload **signatures** ahead of the
// implementation, and `public_api` handed `optional_scalars` the first. For
// `overloaded` that is the one-parameter signature -- it has no `b`, so no
// optional scalar was recorded at index 1, so the wrapper read that argument
// with `nts_from_napi_value`, which accepts every JavaScript value.
//
// `implementation_of` picks the declaration that carries a body. A symbol
// declared once has no body-less sibling to pass over, so the answer there is
// the argument unchanged.
//
// # Why it mattered beyond the argument
//
// `os.setPriority(0, "x")` answered `ERR_OUT_OF_RANGE` where node answers
// `ERR_INVALID_ARG_TYPE`. `validateInt32` opens with `typeof value !== "number"`
// and that branch cannot fire inside a compiled program -- the parameter is
// declared `number`, so the guard folds -- and `Number.isInteger("x")` answered
// instead. **The boundary is what stands in for a guard the declaration
// deleted**, and 52 exported functions in `runtime/node` carry overload
// declarations: fs 32, os 5, timers 4, stream 3.
//
// `viaOverload`, `viaOverloadUnknown` and `viaOverloadLoose` are that half.
// They differ only in the *callee's* parameter type, and all three answered the
// same before the fix -- which is the measurement showing that widening the
// validator is not the repair, because the type at the **call site** is what
// decides the fold. Whoever reads this next should not spend the hour the Node
// lane spent on that.
//
// # Controls
//
// The `control:` line is every shape called with the types it declares, which
// must go on answering exactly as before -- a wrapper that rejected a *valid*
// argument would satisfy the expectation above and fail here.

export function required(a: number): string {
  return typeof a;
}

export function optional(a?: number): string {
  return typeof a;
}

export function secondRequired(a: number, b: number): string {
  return `${typeof a},${typeof b}`;
}

export function secondOptional(a: number, b?: number): string {
  return `${typeof a},${typeof b}`;
}

export function overloaded(a: number): string;
export function overloaded(a: number, b: number): string;
export function overloaded(a: number, b?: number): string {
  return `${typeof a},${typeof b}`;
}

/** `validateInt32`'s shape: declared `number`, guarding against not being one. */
function classify(v: number): string {
  if (typeof v !== "number") return "not-number";
  if (!Number.isInteger(v)) return "not-integer";
  return "integer";
}

export function viaOverload(priority: number): string;
export function viaOverload(pid: number, priority: number): string;
export function viaOverload(pid: number, priority?: number): string {
  if (priority === undefined) {
    priority = pid;
  }
  return classify(priority);
}

/** The same guard, on a parameter declared `unknown` instead of `number`. */
function classifyUnknown(v: unknown): string {
  if (typeof v !== "number") return "not-number";
  if (!Number.isInteger(v)) return "not-integer";
  return "integer";
}

export function viaOverloadUnknown(priority: number): string;
export function viaOverloadUnknown(pid: number, priority: number): string;
export function viaOverloadUnknown(pid: number, priority?: number): string {
  if (priority === undefined) {
    priority = pid;
  }
  return classifyUnknown(priority);
}

/** The same again, with the *call site's* parameter widened rather than the callee's. */
export function viaOverloadLoose(priority: number): string;
export function viaOverloadLoose(pid: number, priority: number): string;
export function viaOverloadLoose(pid: unknown, priority?: unknown): string {
  if (priority === undefined) {
    priority = pid;
  }
  return classifyUnknown(priority);
}

/** Three parameters, to ask whether it is "the second" or "everything after the first". */
export function threeOverloaded(a: number): string;
export function threeOverloaded(a: number, b: number): string;
export function threeOverloaded(a: number, b: number, c: number): string;
export function threeOverloaded(a: number, b?: number, c?: number): string {
  return `${typeof a},${typeof b},${typeof c}`;
}
