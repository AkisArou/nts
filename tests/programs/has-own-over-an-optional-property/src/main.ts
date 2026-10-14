// `Object.hasOwn(o, "k")` where `k` is optional.
//
// The same question `"k" in o` asks, in the other spelling, reading the same
// bit. It refused for the same reason and stopped refusing for the same one:
// an optional property's slot exists whether or not it was written, so the
// declaration says `maybe` is there and the value may disagree — until the
// object header began recording whether a write happened.
//
// # The required key is a constant, and that is the half that can regress
//
// `requiredKey` asks about a property the type settles, and it must compile to
// `true` with no test and no call. It is here because the first version of this
// change made it **refuse**: the path went through `own_names`, which rejects a
// type carrying *any* optional property — because `Object.keys` has to name all
// of them — so asking about a required key was refused on account of a
// different property entirely.
//
// # `fields`, not `declares`
//
// A method is declared and is not an own property: `Object.hasOwn(o, "m")` is
// false for a method in JavaScript. The layout's field list is what says so,
// which is why the constant comes from `fields` rather than from the checker's
// member list.

interface Bag {
  keep: number;
  maybe?: string;
  other?: number;
}

// Written: the bit is set.
export function writtenKey(n: number): number {
  const b: Bag = { keep: n, maybe: "x" };
  return Object.hasOwn(b, "maybe") ? 1 : 0;
}

// Omitted: the slot is there and the bit is not.
export function omittedKey(n: number): number {
  const b: Bag = { keep: n };
  return Object.hasOwn(b, "maybe") ? 1 : 0;
}

// Written as `undefined` — read back it is identical to the omitted case, and
// the answer is not. This is the whole distinction.
export function writtenAsUndefined(n: number): number {
  const b: Bag = { keep: n, maybe: undefined };
  return Object.hasOwn(b, "maybe") ? 1 : 0;
}

// Two optional keys, so a wrong bit index answers about the other one rather
// than crashing. With one optional property every index is 0 and every mistake
// agrees.
export function twoKeysAreDistinct(n: number): number {
  const b: Bag = { keep: n, other: n };
  return (Object.hasOwn(b, "maybe") ? 1 : 0) + (Object.hasOwn(b, "other") ? 2 : 0);
}

// The required key: a constant, on a type that also has optional ones.
export function requiredKey(n: number): number {
  const b: Bag = { keep: n };
  return Object.hasOwn(b, "keep") ? 1 : 0;
}

// A key the type does not declare at all, which is a constant `false`.
//
// Written as a plain string rather than `"absent" as keyof Bag`: the cast makes
// the key an expression rather than a literal, and the lowering then refuses it
// as `a key the program computes` — correctly, and about the cast rather than
// about the key. That arm registered a refusal in an example whose whole point
// is that nothing here refuses.
export function undeclaredKey(n: number): number {
  const b: Bag = { keep: n, maybe: "x" };
  return Object.hasOwn(b, "absent") ? 1 : 0;
}
