// expect: an `in` naming `length` on an `object`
//
// `"length" in value` where `value` is a bare `object`.
//
// # Why this one rather than a bigger row
//
// It is not near the top of the census by breadth. It is at the head of a
// module that has **no compiled pass at all**, which breadth cannot see:
//
//     buffer/src/main.ts:189   "length" in value        <- this
//       hasArrayLikeShape        refused
//       objectToBuffer           refused
//       Buffer.from              cannot be compiled, it calls objectToBuffer
//       bytesOf                  cannot be compiled, it calls Buffer.from
//       StringDecoder#write      cannot be compiled, it calls bytesOf
//       StringDecoder#text       the same
//       StringDecoder            no wrapper: a class whose constructor was not compiled
//
// `string_decoder` publishes nothing and is one of seven modules with zero on
// the axis. `Buffer.alloc` dies on a second head (`Uint8Array#fill`, which the
// compiler has no method for), so this alone does not finish the module -- but
// nothing in it moves while this stands.
//
// A ranking by how many sites a message has puts this well down the list. A
// ranking by cone puts `objectToBuffer` at the top of `string_decoder` with 11.
// Both are worth having and neither is the other.
//
// # Three controls
//
//     "length" in value        value: object            refuses
//     "length" in value        value: { length: number }  compiles
//     "byteLength" in value    value: object            refuses
//
// So it is the bare `object`, not the key: any key refuses, and a declared
// shape compiles. The message says as much -- an array, a `Map`, a `Promise`
// and a `Date` are all `object` and none has a layout to find the name on --
// and the controls confirm the reading rather than trusting it.
//
// # There is no rewrite around it, which is the point of saying so
//
//     Object.hasOwn(value, "length")   an `Object` static over something that
//                                      is not an object
//
// The obvious rewrite is refused too, by a different rule. That matters because
// the alternative to filing a fixture is editing the runtime source, and here
// there is nothing to edit it *to*: `hasArrayLikeShape` is asking the only
// question that answers what it needs to know.
//
// # What it reproduces, and what it does not
//
// The root and two levels of cascade, as in the tree. It does **not** reproduce
// the secondary refusal the real `objectToBuffer` also carries -- an erased
// value at `main.ts:196`, where a value narrowed by the refused predicate is
// passed on. That one is downstream of this and has more branches around it
// than a reduction should carry.

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
