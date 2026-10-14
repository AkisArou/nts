// expect: emit-c --napi -> no wrapper for width: takes TypedArray, which
//          crosses outward only
//
// The control for `view-returned-to-the-host`, and the reason that one is not
// simply "views cross now".
//
// Outward, the wrapper reads bytes this heap already owns and copies them. A
// view *parameter* would have to allocate the storage on this side, which is
// the same asymmetry an object has -- `Cross::Object` is refused as a parameter
// because allocation needs the layout's descriptor and `program.c` keeps its
// own to itself.
//
// Without this fixture the pair reads as "typed arrays cross", and the first
// person to write a wrapper taking one would find out otherwise from a refusal
// rather than from a test.
//
// **This said the generic message until the class arm landed.** `crossings_of`
// computed "takes `TypedArray`, which crosses outward only" and the export pass
// at the bottom of `napi/src/lib.rs` re-derived a reason from the symbol
// instead, so a reader was told the signature did not cross and not which half
// of it or which direction.
//
// It was fixed because publishing a class made it worse rather than because it
// was wrong: a class refused for a nameable reason got *two* lines, the useful
// one followed by "is not a function this backend can name", which has been
// true of every class since before either message existed. The pass now yields
// to a specific reason already given.

export function width(bytes: Uint8Array): number {
  return bytes.length;
}
