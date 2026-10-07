// expect: emit-c --rc -> NTS2006 a host handle counted by `x_sequence_retain`/`x_sequence_release` as a value
//
// Every host class a program erases shares one tag, `NTS_TAG_HANDLE_HOST`, and
// a tag is one family to the runtime: `nts_value_retain` counts it through the
// one pair the host registered. A host class naming another pair, erased,
// would be counted through the wrong functions -- nts:dom's sequence adapters
// (`nts_dom_sequence_retain`) beside its wrappables (`nts_dom_retain`). The
// first pair the program erases is the family's; a function erasing another
// is refused (`check_host_pairs`), naming both.
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude.
//
// Control, one difference -- `keepSequence` removed: nothing refused.
import type { Node, Sequence } from "x:hosts";

export async function keepNode(node: Node): Promise<Node> {
  return node;
}

export async function keepSequence(sequence: Sequence): Promise<Sequence> {
  return sequence;
}
