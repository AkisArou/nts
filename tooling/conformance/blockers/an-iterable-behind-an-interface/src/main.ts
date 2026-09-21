// expect: NTS1001 a method `next` with no declaration in the hierarchy
//
// `for...of` over a value whose **static type is an interface**, where the
// object behind it iterates perfectly well when named by its class.
//
// This fixture pins a *message*, because that is what changed. It refused
// before and it refuses now; what moved is which obstacle it names.
//
// # What it used to say, and why that was wrong
//
// ```text
//                                      before                     now
// interface + generator method         a `for...of` over a value  a method `next`
//                                      that is not a generator    with no declaration
// interface + hand-written iterator    a generator walked in a    a method `next`
//                                      program with none          with no declaration
// ```
//
// Two unlike sentences, neither about the real obstacle, and a reader meeting
// them separately would file two unrelated gaps. Traced with a probe at each
// `generator_walk` call site, both took the **same** path:
//
//     arm3 -> protocol_walk -> generator_walk
//
// `protocol_walk` resolves `[Symbol.iterator]` correctly on a user interface ---
// `collect_interfaces` records symbol-keyed members, so the hierarchy has it ---
// calls it, and then asked `generator_element_of(&iterator_ty)` to decide
// whether what came back was a generator frame. For a receiver named by its
// **class** the answer is a frame (`TypeId(4294311935)`, in the synthetic
// range) and the walk is right. For a receiver named by an **interface** the
// declared return is `Iterator<T>` (`TypeId(5)`), which satisfies that test
// while the value is an ordinary iterator object.
//
// The guard now asks `reserved.is_some()`, which is `Some` exactly when the
// member's declaration is one of this program's generators --- exactly when
// the call produced a frame. That is what the paragraph above it always said
// it meant: "what came back is a frame, which is *resumed*".
//
// # What still blocks it
//
// `Iterator<T>` is declared in TypeScript's lib. `collect_interfaces` walks
// `INTERFACE_DECLARATION` **nodes in the snapshot**, and there is no node for a
// lib type, so `callee_for(iterator_id, "next")` finds nothing. That is the
// same shape as `an-iterable-as-a-stored-type` before it was closed, one level
// in: carrying a type gives it a representation, not a declaration node.
//
// # The obvious fix was tried and is wrong, measured
//
// The members *are* in the snapshot --- `nts types` shows
// `#7 `Iterator` Object { properties: [PropertyRecord { name: "next", ... }] }`
// --- so registering them in the hierarchy from the type record, the way
// `collect_interfaces` does from a declaration node, looks like a dozen lines.
//
// It makes things worse, and `collect_anonymous_objects` says why fifty lines
// away: "registering the second makes `declaring` resolve a call to a function
// nobody wrote". With the lib interfaces registered, `callee_for` answers
// `Callee::Direct("Iterator#next")` and `Callee::Direct("Iterable#__@iterator@19")`,
// and the refusal becomes a **cascade**:
//
//     NTS1003 `module#init` cannot be compiled because it calls
//             `Iterable#__@iterator@19`, which was refused above
//     NTS1003 module evaluation was dropped whole rather than cut here
//
// Measured over `runtime/node`: roots fall 1,576 -> 1,561 sites and cascades
// rise 9,842 -> 9,948. Fifteen refusals move out of the root column by
// becoming a hundred-odd cascades, and the four probe shapes go from a *local*
// refusal to module evaluation being dropped whole --- a bigger blast radius
// for the same program. Reverted.
//
// **The reason it cannot work that way**: a class satisfies `Iterable<T>`
// *structurally*, without writing `implements`, so there is no edge to number
// a dispatch slot against. `callee_for` emits `Callee::Virtual` only where
// `hierarchy.overridden` and `slot_for` agree, and neither can for a type no
// implementor declares. Whatever closes this needs structural dispatch, or a
// provided layout in `builtin.rs` the way `IteratorResult` got one --- not a
// hierarchy entry.
//
// # Measured
//
// The guard change moves **no corpus number**: `runtime/node` is 16,223
// occurrences at 1,576 sites before and after, identical. Paired against a
// binary built at the commit before it, eight generator and iteration controls
// are unchanged --- `yield*`, a generator call, an abstract `Generator<T>`, a
// generator method, `Map`, `Set`, a string, an array --- and the two that
// refuse (`gen-returned`, `gen-in-field`) refuse identically on both, so they
// are this same lib-declaration gap and not a regression.
//
// So it earns its place as a diagnosis fix rather than a capability one, and
// this fixture is what makes that checkable.

interface Seq {
  [Symbol.iterator](): Iterator<number>;
}

class Two implements Seq {
  *[Symbol.iterator](): Iterator<number> {
    yield 1;
    yield 2;
  }
}

const s: Seq = new Two();

export function summed(): number {
  let total = 0;
  for (const v of s) {
    total = total + v;
  }
  return total;
}
