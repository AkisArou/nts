// expect: emit-c --rc -> `tag`, an accessor, as a C record's field is not supported by this lowering yet
//
// The control for `lib-dom-a-record-keyed-on-an-empty-dictionary`: one
// difference -- the dictionary declares `tag`. A conversion would
// read it, and the record holding `size` alone has no field for it,
// so that record does not hold the argument; the one with the field
// is taken, and writing it refuses the method as a field, which is
// this expectation. A member list that excused `tag` here too would
// take the bare record and drop it silently.
class Source {
  size = 1;
  tag(): number {
    return 2;
  }
}

export function probe(): void {
  new EmptyStream(new Source());
}
