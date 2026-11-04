// expect: emit-c --rc -> emits-c nts_dom_new_EmptyStream_1(
//
// A record fit keyed on a dictionary that declares no members at all
// (src/source.d.ts models it). A dictionary conversion reads
// only the dictionary's members, and this one has none, so nothing on
// the argument can be dropped by the record holding `size` alone: it
// holds the argument and, declared first at equal length, is taken,
// which the emitted call states. Known-but-empty is not unknown: were
// the empty member list read as no dictionary in reach, the stricter
// rule would demand a field for `tag` and the record with one would
// be taken instead. Its control is
// `lib-dom-a-record-keyed-on-an-empty-dictionary-control`: the same
// everything, but the dictionary declares `tag`, and there the record
// with a field for it is rightly taken.
class Source {
  size = 1;
  tag(): number {
    return 2;
  }
}

export function probe(): void {
  new EmptyStream(new Source());
}
