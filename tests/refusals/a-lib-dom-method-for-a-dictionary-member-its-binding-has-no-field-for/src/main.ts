// expect: emit-c --rc -> `pull`, an accessor, as a C record's field is not supported by this lowering yet
//
// A dictionary member the argument's class declares as a method, as every
// class implementing a callback member writes it: `pull` is one of the
// checked dictionary's own members, so a record with no field for it does
// not hold the argument, whatever kind of property carries it
// (`record_holds` keys on membership in the checked dictionary, not on
// property kind -- exempting methods would drop callback members
// silently). The binding modeled beside this (src/source.d.ts) offers a
// second record that has the field, declared first, so the choice is
// observable: the call is taken by that one, and writing the record then
// refuses the method as a field, which is this expectation. Were the
// first record wrongly taken, the call would compile and `pull` would
// vanish without a word.
//
// Its control is
// `a-lib-dom-method-for-a-dictionary-member-its-binding-has-no-field-for-control`:
// a method that is not a member does not disqualify, and the shorter
// record is taken -- where a DOMPointReadOnly now fits roundRect's
// dictionary arm the same way
// (a-lib-dom-object-read-as-a-union-dictionary-arm).
class Source {
  chunkSize = 16;
  pull(): number {
    return 1;
  }
}

export function probe(): void {
  new PullStream(new Source());
}
