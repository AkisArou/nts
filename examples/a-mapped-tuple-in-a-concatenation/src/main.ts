// A `.map` whose callback concatenates a **string read out of a tuple** with a
// number converted in the same expression.
//
//     ps.map((e) => e[0] + "=" + e[1].toString()).join(",")
//
// Correct on C, LLVM and the JVM. **Wrong under reference counting**, where it
// disagrees with node on 28 of 29 cases and the bytes read back are freed
// memory. It is listed in `tooling/gate/rc.sh`'s `known_failing` for that
// reason, which is what keeps a wrong answer counted rather than absorbed.
//
// # How it was found, and what it is not
//
// `examples/the-order-own-properties-enumerate-in` wrote `Object.entries(o)
// .map((e) => e[0] + "=" + e[1].toString()).join(",")` to check that names and
// values are reordered together, and that arm — and only that arm — aborted
// under `rc`. The **pre-change binary fails it identically**, so it is not the
// enumeration-order work: that example was simply the first fixture in the
// corpus to write this shape.
//
// `Object.entries` is not implicated either. It produces a tuple array, and a
// tuple array written as a literal fails the same way, which is what this
// fixture writes instead — the smaller subject.
//
// # What each half does on its own
//
// Both halves pass under `rc`:
//
//     ps.map((e) => e[0] + "=")            fine
//     ps.map((e) => e[1].toString())       fine
//     for (const e of ps) { … both … }     fine
//     xs.map((v) => "v=" + v.toString())   fine, no tuple
//
// So it needs all three at once: the callback inlined by `map`, a **managed
// field read out of the element**, and a **frame-allocated** string beside it —
// `nts_number_to_string` emits `frame[40]`, a stack temporary, and a stack
// temporary concatenated with a heap string is where two ownership analyses
// have to agree about a value that is not on the heap.
//
// Nothing here is a claim about which of them is wrong. The point of the
// fixture is that the shape is ordinary, the answer is wrong, and until now
// nothing in the corpus wrote it.

const pairs: [string, number][] = [
  ["a", 1],
  ["b", 2],
];

/** The failing shape, in its smallest form. */
export function mappedAndConcatenated(n: number): string {
  return pairs.map((e) => e[0] + "=" + e[1].toString()).join(",") + (n < 1 ? "" : "!");
}

/** The name alone, which is fine under `rc`. */
export function onlyTheName(n: number): string {
  return pairs.map((e) => e[0] + "=").join(",") + (n < 1 ? "" : "!");
}

/** The number alone, which is fine under `rc`. */
export function onlyTheNumber(n: number): string {
  return pairs.map((e) => e[1].toString()).join(",") + (n < 1 ? "" : "!");
}

/** Both, written as a walk rather than a `map` — fine under `rc`. */
export function theSameWorkInALoop(n: number): string {
  let out = "";
  for (const e of pairs) {
    out = out + e[0] + "=" + e[1].toString() + ";";
  }
  return out + (n < 1 ? "" : "!");
}

/** Both, with no tuple in it — fine under `rc`. */
export function noTupleInvolved(n: number): string {
  const xs: number[] = [1, 2];
  return xs.map((v) => "v=" + v.toString()).join(",") + (n < 1 ? "" : "!");
}

// # Two more shapes in the same family, found by sweeping `rc` directly
//
// A differential under reference counting is a variant nothing sweeps: the
// probe harness does not set `NTS_RC`, and the gate's `rc` step runs the
// corpus rather than new shapes. Twelve one-line programs found two more.
//
//     xs.map((v) => v.toString()).map((s) => s + "!")   28 of 29 disagree
//     xs.map((s, i) => s + i.toString())                28 of 29 disagree
//
// Both are correct without `rc`. What they share with the shape above is a
// **frame-allocated string produced inside an inlined `map` callback** and
// concatenated there — `nts_number_to_string` emits `frame[40]`.
//
// **What they do not share is as informative.** These pass:
//
//     os.map((o) => o.k + "=" + o.v.toString())    an object field, not a tuple
//     ps.map((e) => e[0].toString() + "=" + e[1])  the number read first
//     ps.map((e) => e[0] + "=" + e[1])             no conversion at all
//
// So "a `toString` inside a `map`" is not the rule, and neither is "a managed
// field out of the element". Nothing here names a cause, deliberately: three
// failing shapes and three near-misses is what the next person needs, and a
// guess written down as a cause is worse than none.

const words: string[] = ["a", "b"];

export function chainedMaps(n: number): string {
  const xs: number[] = [1, 2];
  return xs.map((v) => v.toString()).map((s) => s + "!").join(",") + (n < 1 ? "" : "!");
}

export function mapWithAnIndex(n: number): string {
  return words.map((s, i) => s + i.toString()).join(",") + (n < 1 ? "" : "!");
}

/** An object field rather than a tuple element — passes under `rc`. */
export function anObjectFieldInstead(n: number): string {
  const os: { k: string; v: number }[] = [{ k: "a", v: 1 }];
  return os.map((o) => o.k + "=" + o.v.toString()).join(",") + (n < 1 ? "" : "!");
}

/** The number read first — passes under `rc`. */
export function theNumberFirst(n: number): string {
  const ps: [number, string][] = [[1, "a"]];
  return ps.map((e) => e[0].toString() + "=" + e[1]).join(",") + (n < 1 ? "" : "!");
}

// # What the HIR shows, which is as far as reading got
//
// `nts hir --rc` on the failing and passing shapes differ in **one** thing
// inside the mapped callback:
//
//     %12 = concat %10, %11                                   a fresh string
//     %14 = call.extern nts_number_to_string(%27) frame[40]    a STACK temporary
//     %15 = call.extern nts_str_append(%12, %14)               appends in place
//
// The passing `e[0] + "="` has the `concat` and neither of the other two. But
// `o.k + "=" + o.v.toString()` over an **object field** has all three and
// passes, so it is not the append and not the frame string: the discriminator
// is a **tuple** element against an object field, with everything else equal.
//
// Two things were checked and ruled out rather than assumed. The array the
// callback fills is `array.new uninitialized`, and the counting inserts a
// read-then-release of the previous element before each store — which looks
// like releasing garbage on the first iteration and is present in the
// **passing** shape too. And the retain/release sets of the two functions are
// otherwise identical, one `retain` of the global and three `release`s each.
//
// `nts_str_append`'s in-place path is guarded on `a->reserved == 1u`, and its
// comment is the interesting sentence: *"one reference exists and this call is
// consuming it, so nobody can be looking at the units being overwritten. An
// immortal string — a literal, or frame storage — fails it, which is right:
// neither is ours to write."* Whether `%12` really holds the only reference
// when its left operand came out of a tuple is the question this stops at.
//
// # The boundary, from ten more probes
//
// The smallest failing program needs **three** things at once, and each was
// removed in turn:
//
//     two or more elements     one element passes; two and three fail
//     a number conversion      `e[0] + "x"` over the same two passes, and so
//                              does `e[0] + e[1]` when both fields are strings
//     a tuple element          the same expression over an object field passes
//
// The conversion is the factor rather than any spelling of it:
// `e[1].toString()`, `String(e[1])` and `` `${e[0]}${e[1]}` `` all fail, and
// all three produce the number's text into `frame[40]`, a stack temporary.
//
// Things that do **not** matter, each checked rather than assumed: whether the
// tuple's string is an immortal literal or built at run time (`"a" + "x"`
// fails too); whether a string literal appears in the chain at all
// (`e[0] + e[1].toString()` fails); where the tuple is built (inside a function
// it still fails, but on 1 case of 29 rather than 28 — so it is
// **data-dependent**, which is what reading back freed memory looks like).
//
// And the failure is **not** in the source array. `ps[0][0]` after the map is
// correct, and so is `mapped.length`. Only *reading the mapped strings* is
// wrong, which puts it in what the callback returned.
//
// **It is not the ownership optimiser either**, which is the elimination worth
// having: `NTS_RC_NAIVE=1` — counting with every retain and release the model
// asks for and none of the analysis that removes them — fails on the same 28
// of 29 cases. So the disagreement is in the counting *model* or in the
// runtime, and not in `own.rs` deciding a reference is redundant.
//
// # The one contract worth checking first
//
// `nts_str_append` **consumes its left operand**. Its own tail says so:
//
//     if (a->reserved == 1u)            nts_destroy((NtsHeader *)a);
//     else if (a->reserved != IMMORTAL) nts_release((NtsHeader *)a);
//
// and the lowering hands it a **field read**:
//
//     %10 = field.get %9.0        the tuple's own string
//     retain %10
//     %13 = call.extern nts_str_append(%10, %12)
//
// The `retain` is the caller taking the reference the call consumes, so on
// paper it balances. Whether it balances for a string whose only other holder
// is the tuple — and whether the in-place path can ever return the tuple's own
// string as the mapped element, which the later `release` of the mapped array
// would then take a second count from — is where this stops.
//
// **No cause is named here on purpose.** Three failing shapes, three passing
// ones, a boundary in three dimensions, four ruled-out explanations and the
// contract to check is what the next person needs; a guess written down as a
// cause is worse than none, and this file would be the place it went
// unchallenged.
