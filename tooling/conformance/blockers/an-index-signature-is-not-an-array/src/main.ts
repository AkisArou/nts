// expect: indexing `UnknownArrayLike`, which is not an array
//
// An interface whose members are `length` and a numeric index signature is
// structurally an array and is not represented as one.
//
//     interface UnknownArrayLike {
//       readonly length: unknown;
//       readonly [index: number]: unknown;
//     }
//
// That is `runtime/node/buffer/src/main.ts:169`, and `fromArrayLike`'s loop
// reads `source[i]` through it.
//
// # What it is under
//
//     Buffer.from -> objectToBuffer -> fromArrayLike -> source[i]
//
// and under `Buffer.from`: `Buffer.alloc`, `Buffer#fill`, `Buffer#indexOf`,
// `Buffer#lastIndexOf`, `Buffer#includes`, `Buffer.of`, `transcode`, `search`
// — and `StringDecoder#constructor`, which is why **`string_decoder` publishes
// nothing while having no own-source root refusal at all**. Its two export
// wrappers decline as "a class whose constructor was not compiled".
//
// # It used to say something false
//
// Until 2026-09-10 the message was ``NTS1001 `i`, which `UnknownArrayLike` does
// not declare`` — a sentence about the *loop counter's spelling*, said of a
// type. `names_a_property` asked `literal_name(index).is_some()`, and
// `literal_name` answers for any node carrying text, so `source[i]` took the
// property path and looked for a member called `i`.
//
// A reader following that message looks for a member nobody wrote. The fix was
// to ask the index's **type** rather than its text — a literal or a
// `unique symbol` names one member, an ordinary `number` does not — and
// `examples/a-computed-index-is-not-a-member-name` is the guard.
//
// # What it would take
//
// A representation for an array-like: an object type whose only members are a
// length and a numeric index signature has the shape of an array and could be
// one, with the index signature's type as the element type. What makes it a
// decision rather than a mapping is that the *value* arriving is sometimes a
// real array, sometimes a typed array, and sometimes an ordinary object with a
// `length` property — `hasArrayLikeShape` is `"length" in value` and nothing
// more. Those are three storage shapes behind one type, and choosing one at
// compile time would be right for two of them.
//
// So it is filed rather than guessed at. The honest options are a runtime
// helper that reads an element through the descriptor — `nts_array_element`'s
// shape, which already exists for a guard-proved array — or refusing the
// interface and asking `runtime/node` for a narrower one, which is the Node
// lane's file and not this lane's call.
//
// # Controls
//
// `viaRealArray` is the same loop over a `number[]`, which has always worked —
// so what is refused is the *type* and not the indexing. `viaLength` reads the
// `length` member off the same interface and lowers, which says the interface
// is representable and only its elements are not.

interface UnknownArrayLike {
  readonly length: unknown;
  readonly [index: number]: unknown;
}

/** The reduction: a computed index into an index signature, as a parameter. */
function total(source: UnknownArrayLike, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const held = source[i];
    if (typeof held === "number") sum += held;
  }
  return sum;
}

export function subject(n: number): number {
  return total([1, 2, 3], 3) + n * 0;
}

/** Control: the `length` member of the same interface reads fine. */
export function viaLength(source: UnknownArrayLike): number {
  return typeof source.length === "number" ? source.length : 0;
}

/** Control: the same loop over a real array. */
export function viaRealArray(n: number): number {
  const source = [1, 2, 3];
  let sum = 0;
  for (let i = 0; i < source.length; i++) sum += source[i]!;
  return sum + n * 0;
}
