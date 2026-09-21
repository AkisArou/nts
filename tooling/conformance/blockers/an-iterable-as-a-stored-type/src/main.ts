// expect: nothing refused
//
// **Closed 2026-09-21** by carrying `Iterable` and its five siblings through
// decomposition --- six names added to `is_carried`, whose doc says the list
// is matched "by name rather than by shape deliberately". Kept as the
// regression guard. The measurement that justified it is below and is the
// useful part.
//
// ---
//
// **The largest cause on the compiled axis, measured by site.** 267 of the
// **1,738** distinct `runtime/node` refusal sites name one of `Iterable`,
// `Iterator`, `AsyncIterable`, `AsyncIterator` or `AsyncIterableIterator`.
// `WeakRef` is the next comparable family at 67, on the same key.
//
// **It is a cause, not a message row**, and that is why no ranking had shown
// it. The 267 sites are spread across *eight* different diagnostics ---
//
//     715 occurrences  a property `X` of unrepresentable type (...)
//     381              a parameter of unrepresentable type (...)
//     378              a function returning `X`
//      67              a base `X` of unrepresentable type (...)
//      43              a `X` over `X`
//      36              a call result of unrepresentable type (...)
//      10              a conditional of unrepresentable type (...)
//       5              a function returning a union of `X` | `X`
//
// --- so every census that ranked texts split it eight ways. The largest
// message row is `a property of unrepresentable type` at 343 sites, and
// **164 of those 343 are this family**: the biggest row in the census is
// itself nearly half one cause.
//
// All figures are `file:line:column` deduplicated, which is the gate's key and
// the one a count of *places* should use. `node-refusals.mjs` sums
// (site, cause) pairs instead --- 1,741 against 1,738 --- because a site
// blocked two ways is two pieces of work; its header lists all three
// denominators and exactly what separates them.
//
// That ranking only appears once the census is deduplicated. By *occurrence*
// these are scattered under several messages and the top row is a three-line
// generic in `runtime/web-platform` repeated 294 times --
// `tooling/census/node-refusals.mjs` is the ranked form and its header carries
// why the two orders differ.
//
// # It is not the union
//
// The message most of them wear is `a union of `AsyncIterableIterator` |
// undefined`, which reads like a union problem. It is not:
//
// ```text
//   class H { p: AsyncIterableIterator<number> }               refused
//   class H { p: AsyncIterableIterator<number> | undefined }   refused
//   class H { p?: AsyncIterableIterator<number> }              refused
//   interface P { n: number } class H { p: P | undefined }     lowered
// ```
//
// The union machinery is fine --- `T | undefined` for a managed `T` is a
// nullable pointer and costs nothing, which `representation_within`'s own
// comment explains at length. The member has no representation on its own, and
// the union merely reports it. A probe of the union spelling alone would have
// sent a reader to the wrong function: the compiler reports one blocker at a
// time, so the standalone arm has to be written beside it to see that.
//
// # What is missing is a representation, not a protocol
//
// `Walk::Protocol` already calls `next()`, reads `done`, reads `value`, and
// `abstract_generator_kind`'s comment says `Iterator<T>` and
// `IterableIterator<T>` "are satisfied by a hand-written object with a `next`,
// and that shape already works as a protocol object". So iterating one of
// these works where the *static* type is a shape with a layout.
//
// What refuses is holding one: a field, a parameter, a return. `Iterable<T>`
// is `{ [Symbol.iterator](): Iterator<T> }` --- a structural type whose only
// member is keyed on a well-known symbol --- and `layout_of` has no layout for
// it, so `representation_within` answers `None`.
//
// # Why `Erased` is not the answer
//
// It is the representation `object` and `unknown` get, and it is a tag and a
// payload, so it *can* hold one. But `Walk::Protocol` needs a layout to find
// `next` on, and an erased value has none --- storing an iterable as erased
// would move the refusal from the field to every `for...of` over it, which is
// the more common operation. Whatever representation these get has to keep the
// protocol walk working.
//
// `builtin.rs` is where a provided layout would go; it exists for exactly this
// shape and its header explains what stopped `Error` being decomposed.

class H {
  p: Iterable<number> | undefined;
  constructor() {
    this.p = undefined;
  }
}

export function touch(x: number): number {
  const h = new H();
  return x + (h.p === undefined ? 1 : 0);
}
