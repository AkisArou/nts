// expect: lowers
//
// Kept as a guard. Filed 2026-09-10 as what stops `Buffer.from`, and closed the
// same day.
//
// `"length" in value` where `value` is a bare `object`. The whole-program
// answer asks which of the program's object types declare the name and compares
// the value's descriptor against each — complete for classes, and blind to an
// array, a `Map`, a `Set`, a `Promise`, a typed array and an `ArrayBuffer`,
// which are all `object` and none of which has a layout in `program.layouts` to
// find a name on. The lowering refused rather than fold to `false`.
//
// What closed it is that none of them needs a layout: each is one descriptor
// comparison the runtime already performs for `instanceof`, and a function is
// its *tag*. So the list of names it would have got wrong became a table of
// tests, folded onto the class answer with `||`.
//
// # What this guard certifies, and what it does not
//
// It certifies that the four functions below **lower**. It does not certify
// that they answer correctly, and that distinction is the whole risk here: a
// constant `false` lowers just as cleanly as the right test, and a constant
// `false` is what this construct did before the refusal was put in front of it.
//
// The answer is covered by `examples/in-on-an-object-a-native-answers-for`,
// which asks ten receivers — an array, a `Map`, a `Set`, a `Promise`, a typed
// array, a `DataView`, an `ArrayBuffer`, two classes and a plain literal — for
// each of eight names, and compares every answer with node. 290 cases across 10
// functions. Emptying the compiler's table makes eight of those ten disagree
// and leaves the two controls agreeing; emptying only the `Promise` entry makes
// 87 cases disagree. **This file goes green on any of those.**
//
// # The cascade it was filed for, which has since grown
//
//     buffer/src/main.ts:189   "length" in value        <- this
//       hasArrayLikeShape        refused
//       objectToBuffer           refused
//       Buffer.from              cannot be compiled, it calls objectToBuffer
//       Buffer.of                cannot be compiled, it calls Buffer.from
//       Buffer#fill              the same
//       Buffer.alloc             cannot be compiled, it calls Buffer#fill
//       search, transcode        the same
//       bytesOf                  cannot be compiled, it calls Buffer.from
//       StringDecoder#write      cannot be compiled, it calls bytesOf
//       StringDecoder#text       the same
//       StringDecoder            no wrapper: a class whose constructor was not
//                                compiled
//
// **`Buffer.alloc`'s second head is gone and this line is now the only one.**
// When the fixture was filed, `Buffer.alloc` also died on `Uint8Array#fill`,
// which the compiler had no method for. It has one since 2026-09-09, so the
// only refusal left under `Buffer.alloc` is `Buffer#fill` calling `Buffer.from`
// — which is this. Both halves of the `Buffer` API now stand behind one
// `return "length" in value`.
//
// The claim that this alone does not finish `string_decoder` was true when it
// was written and is worth not repeating: it rested on the second head.
//
// # The three controls it was filed with, which still hold
//
//     "length" in value        value: object              answers
//     "length" in value        value: { length: number }  answers
//     "byteLength" in value    value: object              answers
//
// All three were "refuses" and are now "answers". The reading they were for —
// that it is the bare `object` and not the key — was right, and is why the fix
// is a table over names rather than a special case for one of them.
//
// # What it still does not reproduce
//
// The secondary refusal the real `objectToBuffer` also carries: an erased value
// at `main.ts:196`, where a value narrowed by this predicate is passed on. That
// one is downstream of this and has more branches around it than a reduction
// should carry.

interface UnknownArrayLike {
  readonly length: unknown;
  readonly [index: number]: unknown;
}

function hasArrayLikeShape(value: object): value is UnknownArrayLike {
  return "length" in value;
}

function fromArrayLike(source: UnknownArrayLike): number {
  return typeof source.length === "number" ? source.length : 0;
}

function objectToLength(value: object): number {
  if (hasArrayLikeShape(value)) {
    return fromArrayLike(value);
  }
  return 0;
}

export function lengthOfAnyObject(value: object): number {
  return objectToLength(value);
}
