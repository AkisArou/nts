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
// # Three messages, two classifications, one feature
//
// Measured by compiling each spelling rather than read off one truncated
// probe line:
//
// ```text
//   static type     implementation              message
//   -------------   -------------------------   -------------------------
//   interface Seq   *[Symbol.iterator]()        a `for...of` over a value
//                   (a generator method)        that is not a generator
//
//   interface Seq   [Symbol.iterator]()         a generator walked in a
//                   returning a hand-written    program with none
//                   iterator object
//
//   Iterable<T>     either                      a method `__@iterator@NN`
//                                               with no declaration in the
//                                               hierarchy
// ```
//
// **Both user-interface spellings land in `generator_dispatch`**, which is the
// finding: an interface-typed receiver is classified as a *generator* walk
// whatever it actually holds. The first fails because the interface's layout
// has no method at `generator_slot`; the second because a program containing
// no generators has no `generator_slot` at all. Neither reaches
// `protocol_walk`, which is the walk they want. Two unlike sentences, one
// wrong classification.
//
// `Iterable<T>` *does* reach `protocol_walk` --- that is what carrying it
// through decomposition bought --- and then `callee_for` finds
// `hierarchy.declaring(type_id, "__@iterator@NN")` is `None`. That cause is
// narrower than "interfaces do not reach the hierarchy":
// `collect_interfaces` records symbol-keyed members correctly (`member_name`
// falling back to `symbol_member_name`), but it walks `INTERFACE_DECLARATION`
// **nodes in the snapshot**, and `Iterable<T>` is declared in TypeScript's
// lib, where there is no node to walk. Carrying the type gave it a
// representation; it did not give it a declaration node.
//
// So the feature is **iterating through an interface**, not teaching arrays a
// method, and it spans the walk classification as well as the hierarchy.
// `callee_for` already emits `Callee::Virtual` wherever the hierarchy has a
// slot, so the dispatch is built and what is missing is reaching it.
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
