// run: check
// A read the loop's guard proves in range, after a call that shrank the array.
//
// `i < xs.length` is tested at the top of each iteration, and the bounds pass
// trusts it for the read `xs[i]` later in the same block -- after `xs.pop()`
// has made the array one shorter. When `i` is the new length the read is past
// the end: node answers `undefined`, and the compiled program, its check
// removed, read the slot `pop` had just emptied (released, under reference
// counting): `v1,` where node prints `undefined,`.
//
// Found by MainClaude (2026-10-14) reading bounds.rs: a relation proved at the
// top of a block (`flow.rs` `relations`) held for every read in it, whatever
// ran between.
//
// Control, one difference -- the read before the pop -- agrees with node,
// and rightly keeps its check removed:
//
//     s += xs[i] + ",";
//     xs.pop();

export function go(n: number): string {
  const xs: string[] = [];
  // Bounded, so a pool value in the loop bound finishes: the subject is the
  // shrinking read, not the count.
  for (let k = 0; k < (n & 15); k++) xs.push("v" + k);
  let s = "";
  for (let i = 0; i < xs.length; i++) {
    xs.pop();
    s += xs[i] + ",";
  }
  return s;
}
