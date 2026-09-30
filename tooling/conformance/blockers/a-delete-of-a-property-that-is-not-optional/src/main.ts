// expect: NTS1001 a `delete` of `c` on the anonymous `{ a, b, c }`, which does not declare it optional
//
// `delete o.c` where `c` is **not optional**. TypeScript refuses it too --
// `TS2790: The operand of a 'delete' operator must be optional` -- so nothing a
// checker accepts is refused here, and the `@ts-expect-error` below is what it
// takes to reach the lowering at all.
//
// **It was `outcomes/object-entries-after-a-getter-deletes-a-later-key`,
// category `aborted`, and that record named the wrong cause for four weeks.**
// Its header said *"the crash is Object.entries meeting a key deleted part
// way"*. It is not: `delete` alone crashes, with no `Object.entries` anywhere in
// the program. Reduced to a `delete bag.c` followed by a template read of
// `bag.a` and `bag.c`, node answers "Aundefined" and nts segfaulted.
//
// **The mechanism, read out of the emitted C rather than reasoned about.** The
// getter compiled to
//
//     static NtsString * Type2__get_u0020_b(NtsObj_Type2 * v0) {
//         v2 = (NtsString *)0;
//         v0->c = v2;                 // delete this.c  ==>  c = NULL
//
// with `c` in the descriptor's reference list. Lowering builds the `undefined`
// and `coerce_to_slot` re-makes it at the slot's own representation -- an arm
// licensed by the checker having approved an *assignment*, where a `delete`
// invents the value and nothing approved it. So a required `c: string` took a
// null `NtsString *`, which is neither `undefined` nor a string, and the next
// read of `c` dereferenced it.
//
// # Why the defect this replaced can no longer be written down
//
// The two halves of the original program refuse for two different reasons, and
// between them they leave nothing to record:
//
//   c required   this file: the `delete` refuses, because the slot is a
//                `NtsString *` with no room for an absence in it.
//   c optional   `Object.entries` refuses -- *"an `Object` static over a type
//                with the optional property `c`, whose presence is a fact
//                about the value rather than the type"* -- which is the refusal
//                `examples/delete`'s header names as what makes deleting sound
//                at all.
//
// And the two cannot be separated: a literal carrying a getter cannot be
// annotated to an interface (*"supplied as an accessor where the type declares
// storage"*), and an unannotated literal never infers a `?`. So
// `Object.entries` meeting a key an earlier getter deleted is not reachable in
// this compiler from either side, which is why no fixture replaces that one.
// Found by test262's `Object/entries/getter-removing-future-key.js` and
// `Object/values`' twin; both are behind the `Object`-static refusal above.
//
// **Control, and it is the half that matters:** `optional` deletes a property
// that *is* optional and must keep compiling. A rule that refused every
// `delete` would satisfy the expectation above, and `examples/delete` and
// `examples/an-optional-property` -- which run, on four backends, and agree
// with node -- are what it would break.
const deletes = {
  a: "A",
  get b() {
    // @ts-expect-error -- TS2790: the operand of a `delete` must be optional
    delete this.c;
    return "B";
  },
  c: "C",
};

export function reads(): string {
  return deletes.b + deletes.c;
}

interface Held {
  keep: string;
  gone?: string;
}

export function optional(): string {
  const held: Held = { keep: "k", gone: "g" };
  delete held.gone;
  return held.gone === undefined ? held.keep : "still there";
}
