// expect: emit-c --napi -> calls (() => { try { exports.optionalSecond(1, "y"); return "no throw"; } catch (e) { return e.message; } })() === "The \"second\" argument must be of type number. Received type string"
// control: exports.optionalSecond(1, 3) === 3
//
// FIXED, and kept as a guard, with both faces of it in the header below.
//
// An optional parameter whose body observes the absence crosses as an **erased**
// value, and `nts_from_napi_value` accepts every JavaScript value. So the
// wrapper let a string through and `unerase` read its pointer as a double --
// `6.9231110677068e-310` -- and `os.getPriority(null)` returned where node
// throws. One defect, two faces: a value nobody supplied, and a missing
// exception.
//
// The type was the only thing missing at the boundary. `Param` carries `ty`,
// which is `Erased`, and `shape`, which says optional, and neither says what the
// optional half *was*. `Program::optional_scalars` records it, the way
// `opaque_signatures` records the other thing only the wrapper needs.
//
// Measured on `os.getPriority` against node over the twelve inputs
// `test-os-process-priority.js` uses: `null`, `true`, `false`, `'foo'`, `{}`,
// `[]` and `/x/` all agreed after this and none did before. The five range cases
// -- NaN, the infinities, 3.14, 2**32 -- still differ, and for a different
// reason: the module's validator runs and throws, and its `code` does not cross.
//
// An **optional** parameter whose conversion fails is left uninitialised, and
// the uninitialised value reaches the module.
//
//     optionalSecond(1, "y")   6.93440385475405e-310   <- a pointer read as a double
//     optionalSecond(7)        7
//     optionalSecond(1, 3)     3
//     requiredSecond(1, "y")   throws: The "second" argument must be of type number
//
// **The fourth row is the control that names it.** A *required* parameter whose
// conversion fails is rejected with node's own message -- that landed in
// `fe58e916`. The optional one is not checked at all, so
// `napi_get_value_double` fails, the local keeps whatever was on the stack, and
// the module's validator receives a number it was never given.
//
// A wrong *value* rather than a wrong message, which is the worse of the two: a
// caller cannot tell it happened, and the module's own validation runs on the
// garbage and reports about it. `os.setPriority(1, "y")` says
//
//     The value of "priority" is out of range. It must be an integer.
//       Received 6.9405809693039e-310
//
// where node says `The "priority" argument must be of type number. Received
// type string ('y')`. The module is doing its job correctly on an input the
// boundary invented.
//
// # It has a second face, and one fixture covers both
//
// A garbage value is one way this shows. The other is **a missing exception**:
//
//     getPriority(null)    ours returns, node throws ERR_INVALID_ARG_TYPE
//     getPriority(false)   the same
//
// `os.getPriority(pid?: number)` takes its parameter optionally, so a `null`
// argument whose conversion fails leaves the local unchecked, and whatever it
// holds passes `validateInt32`. Nothing throws.
//
// That is how `test-os-process-priority.js` fails *now*. It used to fail on the
// wording of a different error; the compiler lane fixed the wording, `os` stayed
// at 5 passed and 4 failed, and the failure had moved. Traced through all twelve
// of the inputs that test uses -- `null`, `true`, `false`, `'foo'`, `{}`, `[]`,
// `/x/`, `NaN`, `Infinity`, `-Infinity`, `3.14`, `2**32` -- exactly those two
// disagree.
//
// Worth the paragraph because the two faces look like different bugs: one
// returns a number nobody supplied, the other returns successfully when it
// should throw. They are the same unchecked conversion.
//
// # It is a `calls` fixture and could not be anything else
//
// The wrongness only appears when the **host** passes a value the parameter's
// type does not admit, so it cannot be written inside the compiled program:
// TypeScript will not let a `string` reach a `number | undefined` parameter, and
// an `agreements/` case runs entirely inside. The `calls` form is the host, which
// is where the bad argument has to come from.
//
// The expectation asserts what is true now -- a number that is neither the
// argument nor the default and is too small to be either -- so when the boundary
// starts rejecting it, the expression goes false and the run says FIXED.
//
// Reported by the compiler lane from the `os.setPriority` end, where the
// parameter was read as `unknown`. It is declared `number` and optional; the
// reduction here does not need `unknown` at all.

export function optionalSecond(first: number, second?: number): number {
  if (second === undefined) return first;
  return second;
}

export function requiredSecond(first: number, second: number): number {
  return first + second;
}
