// expect: so `params` has no storage at any offset and a pointer cast cannot
//         widen a struct
//
// **The shape that publishes sixteen `zlib` exports, and the one where a
// structural copy cannot help.**
//
// TypeScript's assignability for an all-optional interface runs the *opposite*
// way to storage: `Narrow` has two fields and `Wide` has three, every one of
// them optional, so `Narrow` is assignable to `Wide` and a value of it has no
// slot for `params`. A pointer cast cannot widen a struct, and there is no
// order to lay the fields in that would let it.
//
// `runtime/node/zlib/src/iter.ts` is exactly this, three times over:
//
// ```ts
// interface IteratorEngineOptions
//   extends IteratorZlibOptions, IteratorBrotliOptions, IteratorZstdOptions {}
// ```
//
// with `compressGzip(options: IteratorZlibOptions = {})` handing its argument
// to `asyncTransform(mode, options: IteratorEngineOptions)`. Sixteen exports in
// that file are behind it, and `main.ts:621` has the same pair one name over.
//
// ## What a structural copy does here, which is relocate it
//
// `structural_instantiations` makes the copy the seam asks for --
// `asyncTransform@1obj10228` takes an `IteratorZlibOptions` -- and the copy's
// body does `new AsyncCompressionTransform(mode, options)` against a
// constructor still declaring the wide type, so the cast comes back one call
// in. **Extending the copy machinery through the `new` does not fix it**, and
// that was checked rather than assumed on 2026-09-23:
//
// - `calls_in_the_body_of` collects `CALL_EXPRESSION` and not `NEW_EXPRESSION`,
//   so a copy's `new` is outside the transitive walk. That is a real gap;
// - and it is not this one. A constructor copy taking the narrow type would
//   then store it into `#options`, a field declared at the wide type, which is
//   the same widening one level further down. The class would have to be copied
//   too, and its field, and whatever reads the field.
//
// Every copy relocates the cast because the copy machinery changes *parameter*
// types, and what has no storage here is the object. So this is a
// representation question -- what an interface's layout is when values of
// several narrower interfaces reach it -- and not a specialisation one.
//
// ## The diagnostic used to point the other way
//
// Until 2026-09-23 this refused with "a pointer cast between two structs that
// do not agree about where their shared fields are", which is a sentence about
// *ordering*, and ordering is genuinely the story for some of these sites. It
// is not the story for any of the six in `iter.ts`: the target declares eight
// fields and the sources hold six, three and four. Reading the message as
// written sent a day's plan into `record_structural_call`. `NotAPrefix` splits
// the two, so a census can say how much of the seam is the cheap half.
//
// The two layouts, from `nts layouts runtime/node/zlib/tsconfig.json`:
//
// ```text
// IteratorZlibOptions [10228]    windowBits level memLevel strategy chunkSize dictionary
// IteratorEngineOptions [10234]  chunkSize dictionary windowBits level memLevel strategy params pledgedSrcSize
// ```
//
// Note that they disagree about order *as well*, and that that is a fact about
// the checker rather than about this compiler: `fields_of` lays a type out in
// the order `PropertyRecord`s arrive in, and tsgo lists a type's own members
// before its inherited ones -- so a subtype and its supertype order their
// shared fields differently whenever the subtype declares any of its own.
// Ordering is reported only where it is the binding constraint, which is why
// these sites say "widen" and not "disagree".

interface Common {
  chunkSize?: number | undefined;
}

interface Narrow extends Common {
  level?: number | undefined;
}

interface Other extends Common {
  params?: number | undefined;
}

/** Three fields, all optional, so a `Narrow` is assignable to it. */
interface Wide extends Narrow, Other {}

class Engine {
  readonly options: Wide;

  constructor(options: Wide) {
    this.options = options;
  }
}

function make(options: Wide): Engine {
  return new Engine(options);
}

/** The blocker: `Narrow` holds two fields and `Wide` reads three. */
export function fromNarrow(options: Narrow = {}): number {
  return make(options).options.params ?? 0;
}

/**
 * The control, and it lowers: a `Wide` reaching a `Wide` needs no cast, so the
 * refusal above is about the two layouts and not about `make`, `Engine`, or the
 * default parameter. Without this arm a regression that refused every call here
 * would read exactly like the blocker.
 */
export function fromWide(options: Wide = {}): number {
  return make(options).options.params ?? 0;
}
