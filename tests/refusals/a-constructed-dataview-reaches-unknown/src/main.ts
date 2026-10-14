// expect: emit-c -> emits-c nts_is_data_view
//
// A `DataView` constructed here, passed to an `unknown` parameter, and asked
// about. All three links, because the middle one was the missing one.
//
// `instanceof DataView` landed in both backends and the JVM lane could not
// exercise it: a probe that constructed a `DataView` and erased it refused with
//
//     NTS1001 a value of type Managed(DataView) where `unknown` is expected
//
// and the C lane refused the identical program with the identical message. Two
// lanes agreeing on a refusal is what said the gap was upstream of either --
// `erasable`, in the lowering, which decides whether a value may be *asked
// about* at all.
//
// **`erased_tag` in the C backend had carried `DataView` and `Date` for longer
// than it had carried `AnyView`**, under the same `NTS_TAG_OBJECT` as every
// other reference. The boxing was always emittable. Only the predicate said no.
//
// That is the sixth time this list has gone stale and the first with two
// entries at once. Its own comments record the previous five. The pattern does
// not vary: a variant is added to `ManagedType`, taught to the backend that has
// to spell it, and not to the predicate that decides whether it may be asked
// about -- and **a test is worth nothing if the value cannot get into the thing
// being tested**, which is the sentence three of those five comments already
// say in their own words.
//
// `uint8` is the control. `View` has been erasable since it was added, so it
// crosses whatever this file does -- which is what makes the subject's failure
// about `DataView` rather than about views, and what would catch a fix that
// broke erasure generally while making this one line pass.

function describe(value: unknown): string {
  if (value instanceof DataView) return "DataView";
  if (value instanceof Date) return "Date";
  if (value instanceof Uint8Array) return "Uint8Array";
  return "other";
}

export function subject(): string {
  return describe(new DataView(new ArrayBuffer(8)));
}

export function control(): string {
  return describe(new Uint8Array(4));
}

// A `Date` went in with the `DataView`: `erased_tag` had carried both for the
// same length of time and `erasable` had learned neither, so they were one
// omission rather than two. `new Date(ms)` and not `new Date()` -- the
// no-argument form reads a clock, which is refused on purpose and by a
// different rule.
export function dated(ms: number): string {
  return describe(new Date(ms));
}
