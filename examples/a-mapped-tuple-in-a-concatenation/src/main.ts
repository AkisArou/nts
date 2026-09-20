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
