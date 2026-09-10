// expect: emit-c --napi -> calls (() => { const p = (f, ...a) => { try { f(...a); return "accepted"; } catch (e) { return "rejected"; } }; return [p(exports.required, "s"), p(exports.optional, "s"), p(exports.secondRequired, 1, "s"), p(exports.secondOptional, 1, "s"), p(exports.overloaded, 1, "s")].join(",") === "rejected,rejected,rejected,rejected,accepted" && exports.overloaded(1, "s") === "number,string" && exports.viaOverload(1, "s") === "not-integer" && exports.viaOverloadUnknown(1, "s") === "not-integer" && exports.viaOverloadLoose(1, "s") === "not-number"; })()
// control: exports.required(1) === "number" && exports.optional(1) === "number" && exports.secondRequired(1, 2) === "number,number" && exports.overloaded(1, 2) === "number,number" && exports.viaOverload(1, 2) === "integer" && exports.viaOverloadLoose(1, 2) === "integer"
//
// An overloaded function's wrapper does not check its arguments, and every other
// shape's does.
//
// Found in `os.setPriority`, where `setPriority(0, "x")` answers
// `ERR_OUT_OF_RANGE` and node answers `ERR_INVALID_ARG_TYPE`. Wrong error type
// is the one thing about an error the goal will not trade.
//
// # The table, measured
//
//     required("s")           threw          the wrapper rejects it
//     optional("s")           threw
//     secondRequired(1, "s")  threw
//     secondOptional(1, "s")  threw
//     overloaded(1, "s")      "number,string"   the string arrives, as a string
//
// So it is not coercion -- the value is not converted to a number on the way in,
// it simply is not checked. Four shapes reject and the overloaded one does not.
//
// It is the *second* argument specifically, and the first is still checked:
//
//     overloaded("s", 1)      threw
//     overloaded(1, "s")      "number,string"
//
// which is also why `os.setPriority("not-a-pid", 1e9)` gives node's error and
// `os.setPriority(0, "x")` does not. And `secondOptional(a: number, b?: number)`
// -- optional, second, not overloaded -- rejects. So neither "second" nor
// "optional" is the trigger on its own; the two together, under overloads, are
// what this reproduces. What the emitter does to produce that is not something
// this fixture can see, and it does not guess.
//
// # Three explanations ruled out before this was written
//
// `os.getPriority(pid?: number)` does not let a string through, so it is not
// "optional". `setPriority`'s own first parameter does not, so it is not "a
// number parameter" and not the boundary in general. `getPriority` sits in the
// same module built the same way, so it is not the module. What is left is the
// one difference visible in the source: overload declarations.
//
// # And what the module does with the string once it has it
//
// `viaOverload` is `setPriority`'s exact shape -- an overloaded function handing
// its parameter to a helper whose own parameter is declared `number` and which
// opens with a `typeof` guard. A compiler entitled to believe that declaration
// may fold the guard away, and nothing else in a module would ever notice,
// because nothing else can put a string there.
//
//     "not-number"   the guard fired; the declaration did not erase it
//     "not-integer"  the guard was folded, and the next check answered instead
//
// The second is what `os` shows: `validateInt32("x", …)` reaching
// `Number.isInteger` rather than its own type branch. Two facts compose into the
// wrong error, and either alone would be survivable.
//
// # Which declaration the fold follows, measured both ways
//
// Widening the *validator's* own parameter does nothing:
//
//     viaOverloadUnknown   classify(v: unknown)      "not-integer"   still folded
//     viaOverloadLoose     priority: unknown         "not-number"    the guard runs
//
// So it is the type at the **call site** that decides, not the callee's. That is
// worth knowing before reaching for a fix: the obvious repair -- widen the
// validator, which is the function actually doing the checking -- is the one that
// does not work. `os.setPriority` took the second form, keeping node's two
// documented overloads and widening only the implementation's `priority`.
//
// It does not close the test it came from. `test-os-process-priority.js` also
// passes objects, and those meet the inbound-reference wall
// (`a-reference-cannot-cross-inward`) with a message of its own. Before this, the
// test died earlier on a scalar and never reached them -- the object half was
// always failing and was masked.

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
