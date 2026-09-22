// expect: NTS1003 `summed` cannot be compiled because it calls `Iterable<2>#__@iterator@10`, and no class in this program implements it
//
// **The expectation moved on 2026-09-22, one link further in.** It read
// `NTS1001 a method __@iterator@N with no declaration in the hierarchy`,
// which was the hierarchy answering about a type nobody had told it about:
// `collect_interfaces` walks `INTERFACE_DECLARATION` nodes and the library
// `Iterable<T>` has none. `collect_carried_protocols` tells it now, so the
// lookup succeeds and the missing thing is an *implementer* -- which for an
// **array** assigned to an `Iterable<T>` is the case this fixture is about,
// since nothing relates the array to the protocol.
//
// The two arms of the table below are now different work: a class that says
// `implements Iterable<T>` lowers, and an array or a generator frame does
// not, because neither writes a heritage clause and nothing else wires them.
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
// **That table is now out of date for the first two rows**, and the way it was
// wrong is worth keeping. I wrote that an interface-typed receiver is
// "classified as a generator walk whatever it actually holds" and that neither
// spelling reaches `protocol_walk`. Probing each `generator_walk` call site
// says both *do* reach it --- `arm3 -> protocol_walk -> generator_walk` --- and
// the misclassification happened one step later, inside `protocol_walk`, on
// the type of the iterator it had just built. `collect_interfaces` records
// symbol-keyed members, so the hierarchy had `[Symbol.iterator]` all along.
//
// Fixed in the commit that adds `blockers/an-iterable-behind-an-interface`,
// which carries the measured trace. Both user-interface spellings now say
// `a method `next` with no declaration in the hierarchy`, which is the real
// obstacle: `Iterator<T>` is a lib type with no declaration node.
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
