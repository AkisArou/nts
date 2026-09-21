// expect: NTS1001 a method `__@iterator@
//
// An **array** assigned to an `Iterable<T>`, then walked.
//
// This is the next link in the chain that opened when `Iterable` and its
// siblings were carried through decomposition. Before that the refusal was
// `a property `p` of unrepresentable type (`Iterable`)`; the type now has a
// representation and the walk gets one step further, to looking for
// `[Symbol.iterator]` on what is actually stored.
//
// An array does not declare that method in its hierarchy. `for (const v of
// xs)` over an array lowers perfectly well --- it is a counted loop over the
// storage, and no protocol object is built --- but reaching an array *through*
// an `Iterable<T>` slot means the receiver's static type is the protocol, so
// the walk asks the hierarchy and the hierarchy has no such member.
//
// So this is a question about giving the array types a `[Symbol.iterator]`
// entry that the protocol walk can find, and not about `Iterable` at all.
// `abstract_generator_kind`'s comment says the protocol "is satisfied by a
// hand-written object with a `next`" --- an array is not one of those.
//
// `is_carried`'s own doc predicted the shape of this: "the cascades rise,
// which is the shape to expect and not a regression: a function that used to
// stop at an unrepresentable property now gets further and stops at the next
// thing". Measured, the corpus went from 1,738 refusal sites to 1,576 while
// `a method `X` with no declaration in the hierarchy` went from 55 sites to
// 158 --- this row rising is most of that.

class Holder {
  items: Iterable<number>;
  constructor() {
    this.items = [1, 2];
  }
}

export function summed(n: number): number {
  const h = new Holder();
  let total = 0;
  for (const v of h.items) {
    total = total + v;
  }
  return total + n;
}
