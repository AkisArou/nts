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
// **It is not about arrays**, which is what this fixture first said. The
// receiver being an array is incidental; what decides it is whether the
// receiver's *static* type is a concrete class or an interface:
//
// ```text
// class Two { *[Symbol.iterator](): Iterator<number> { yield 1; yield 2; } }
//
// const s = new Two();                for...of  lowered
// const s: Seq = new Two();           for...of  refused   (a hand-written
//                                                          iterable interface)
// const s: Iterable<number> = new Two();        refused
// const s: Iterable<number> = [1, 2];           refused
// ```
//
// The same object, iterated four ways. Only the one whose static type is the
// class works. `for (const v of xs)` over an array lowers too --- that is the
// counted loop `walk_condition` documents, "an array is the one case where the
// answer is known and the loop is a counter" --- and reaching *any* value
// through an interface-typed slot leaves the protocol walk asking a hierarchy
// that has no entry.
//
// The two interface spellings fail in different places, which is why they wear
// different messages:
//
//   * a **user** interface stops before `protocol_walk` runs at all, with
//     `a `for...of` over a value that is not ...`;
//   * `Iterable<T>` reaches `protocol_walk`, gets a mangled name out of
//     `symbol_property_name`, and then `callee_for` finds nothing:
//     `hierarchy.declaring(type_id, "__@iterator@NN")` is `None`.
//
// So the feature is **iterating through an interface**, not teaching arrays a
// method. `callee_for` already emits `Callee::Virtual` where the hierarchy has
// a slot --- the gap is that an interface's symbol-keyed member never reaches
// the hierarchy, so the dispatch it would use is never considered.
//
// `is_carried`'s own doc predicted the shape of this: "the cascades rise,
// which is the shape to expect and not a regression: a function that used to
// stop at an unrepresentable property now gets further and stops at the next
// thing". Measured, the corpus went from 1,738 refusal sites to 1,576 while
// `a method `X` with no declaration in the hierarchy` went from 55 sites to
// **78** --- this row rising is most of that. (An earlier draft said 158,
// which was that row counted on a different key; see the example's header.)

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
