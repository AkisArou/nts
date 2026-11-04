// expect: emit-c --rc -> emits-c nts_dom_new_PullStream_1(
//
// The control for
// `a-lib-dom-method-for-a-dictionary-member-its-binding-has-no-field-for`:
// one difference -- the class's method, `helper`, is not a member of the
// checked dictionary, so a dictionary conversion never reads it and the
// shorter record (which has no field for it either) holds the argument.
// Keyed on every declared property, as before, this took the longer
// record instead; keyed on the checked dictionary's members, it takes
// the shorter, which the emitted call states.
class Source {
  chunkSize = 16;
  helper(): number {
    return 1;
  }
}

export function probe(): void {
  new PullStream(new Source());
}
