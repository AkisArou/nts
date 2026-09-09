// expect: a module-scope `let` holding a function, which may be reassigned with a closure of another layout
//
// **The refusal names `let` and the declaration below is `const`.** The reason
// it gives -- that the binding "may be reassigned with a closure of another
// layout" -- cannot apply to a `const`, which is exactly the property `const`
// has. So either the check does not distinguish the two, or it does and the
// message does not.
//
//     function twice(n: number) { … }          -> lowers
//     const twice = function (n: number) { … } -> REFUSED, as a `let`
//
// `declared` is the control: the same body, the same call, a function
// *declaration* instead of a value bound to a name.
//
// **This matters beyond the wording.** If the reasoning is what gates it, a
// `const` is already immune and could lower today. If the check is really about
// something else -- a function *value* rather than a declaration, whatever its
// binding -- then the message is describing a condition it is not testing, and
// the next person to read it will look for reassignments that are not there.
// That is the same defect class as `path`'s `no declaration in the hierarchy`:
// a true-sounding sentence about something that is not what happened.
//
// **7 distinct sites** report this message: web-platform 2, stream 2,
// internal 2, util 1. **Two are genuinely `let` and the message is right about
// them** -- `stream/src/duplex.ts:330` and `stream/src/readable.ts:1079`, both
// late-bound on purpose to break an import cycle:
//
//     let duplexifyImpl: (body: unknown, name: string) => Duplex = () => { … }
//
// `internal/time.ts:68` is `export const now: () => Timestamp = nts_hrtime_ns`,
// a `const`, and its call sites are among the seven. The remaining sites are
// **not attributed** -- the diagnostic points at the call, not the declaration,
// and mapping the two by reading the first identifier on the reported line gave
// `set` and `log` for a chain whose module-scope function is `now`. A count of
// how many of the seven are `const` would be a guess, so it is not given.

const twiceValue = function (n: number): number {
  return n * 2;
};

function twiceDeclared(n: number): number {
  return n * 2;
}

export function declared(n: number): number {
  return twiceDeclared(n);
}

export function value(n: number): number {
  return twiceValue(n);
}
