// expect: a name from an enclosing scope
//
// A nested function reading a local of the function that declares it.
//
//     function outer(columns) { function inner(i) { return i * columns; } }
//                                                       ^ REFUSED
//
// `control` takes the same value as a parameter and does the same arithmetic,
// so what is refused is the capture and not the multiplication. Without it the
// diagnostic reads as "nested functions are not supported", which is false --
// `unread` below is nested too, reads nothing from around it, and lowers.
//
// One of `path`'s six own-source roots, at `src/glob-matcher.ts:596`. `visit`
// is a recursive matcher closing over `columns` and `memo` from the function
// that built them; both are locals of the caller, and there is no spelling of a
// memoised recursive match that does not read them.

export function control(columns: number, index: number): number {
  return index * columns;
}

export function unread(): number {
  function inner(index: number): number {
    return index * 2;
  }
  return inner(3);
}

export function subject(columns: number): number {
  function visit(index: number): number {
    return index * columns;
  }
  return visit(2);
}
