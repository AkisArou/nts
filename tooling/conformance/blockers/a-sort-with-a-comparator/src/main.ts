// expect: NTS1001 a `sort` with a comparator, which would have to call back into it

// `xs.sort(cmp)` — the comparator form, which is a different feature from the
// default one and refuses by name rather than falling through to `this array
// method is not supported`.
//
// `sort()` with no comparator landed on 2026-09-17 as a plain runtime helper:
// no callback, so no machinery. Every one of the three sites in `runtime/node`
// is that form, which is what made it the cheap half.
//
// The comparator is not a harder version of it. The callback would have to be
// reached from **inside** the sort, which is neither of the two shapes this
// compiler has for a callback: it is not the inlined-into-a-loop shape every
// other array method takes — those call the body once per element, in the loop
// body, and a sort needs one in a nested loop's condition — and it is not a C
// function pointer either, once the arrow captures anything.
//
// Filed rather than left silent so that whoever builds it finds the analysis.
// The three routes, with what each costs:
//
//   bridge the arrow to a function pointer and call a runtime sort
//     — works on C and LLVM; the JVM relates classes by name and would need
//       its own answer, and a capturing comparator has no bridge at all
//   emit the sort as HIR with the body inlined
//     — no runtime surface and all three backends for free, but the callback
//       machinery delivers one value per element into a loop this compiler
//       built, and this needs one inside a condition
//   a stable sort in the runtime taking a closure object
//     — one helper per backend, and the JVM half is the only one that is short
//
// A `FIXED` here means one of the three was built; a `CHANGED` means the
// refusal moved, which is worth reading because the message names the reason.

export function f(n: number): string {
  const xs = ["b", "a", String(n)];
  xs.sort((a, b) => (a < b ? -1 : 1));
  return xs[0]!;
}
