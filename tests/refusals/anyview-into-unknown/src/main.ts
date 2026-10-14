// expect: lowers
//
// **FIXED in fc0df644, kept as a guard.** Nothing refuses. Spelled `lowers` rather than `nothing refused`
// because the latter also requires the wrapper to carry it, and the
// wrapper's limits here are somebody else's blocker.
//
// The filing below is kept because what it argued is why the fix took the
// shape it did.
//
//
// A concrete view boxes into `unknown`. An `AnyView` does not.
//
//     takesUnknown("u8",   someUint8Array)     -> lowers
//     takesUnknown("str",  someString)         -> lowers
//     takesUnknown("view", someArrayBufferView) -> REFUSED
//
// Both controls above the subject must stay clean: without them the diagnostic
// reads as "values do not box into `unknown`", which is false and would point at
// boxing generally rather than at one representation missing from it.
//
// **A follow-on of `ac27dac4`, not a regression.** Before `ArrayBufferView` was
// a representation there was no `AnyView` to box, so this could not be reached;
// the parameter was refused first. It is what "a cone sizes a queue rather than
// a step" looks like from the inside.
//
// `buffer` is where it shows: five refusals cleared and five appeared, total
// unchanged at 79. Four of the five revealed were ordinary next-in-queue work --
// `Date.now`, two more `a method without a body`, one more `length` of something
// without one -- and this is the fifth, the one the new representation created.
//
// **One site, five modules.** `runtime/node/buffer/src/blob.ts:443`, in
// `copyView`, passing the rejected view to `ERR_INVALID_ARG_TYPE` whose third
// parameter is `unknown` -- which is node's own signature, transcribed. It is
// reached through the cone by `buffer`, `string_decoder`, `url`, `os` and
// `querystring`, so the per-module count of 1 each is the same site five times
// rather than five sites.
//
// `unknown` in parameter position is node's validator signature and
// `internal/validators.ts` is imported by every module here, so the shape has
// more room to spread than one site suggests.
function takesUnknown(label: string, value: unknown): string {
  return label + String(value === undefined);
}

export function concreteViewIntoUnknown(view: Uint8Array): string {
  return takesUnknown("u8", view);
}

export function stringIntoUnknown(text: string): string {
  return takesUnknown("str", text);
}

export function anyViewIntoUnknown(view: ArrayBufferView): string {
  return takesUnknown("view", view);
}
