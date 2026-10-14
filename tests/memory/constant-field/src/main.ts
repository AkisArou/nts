// A frame object whose reference field only ever holds a string literal.
//
// A frame object has no destructor, so the counting pass emits by hand the walk
// that gives its fields back where the frame ends. A field holding a literal has
// nothing to give back -- the string is static data the runtime treats as
// immortal -- so the walk is a load, a call and a branch to decide nothing, once
// an iteration.
//
// An object *literal*, and it has to be. A class puts the store in the
// constructor, which is a separate function -- and the analysis that decides a
// slot is inert gives up on a function containing a call, because a store
// through anything it was handed could be aimed anywhere. Rewriting this as
// `new Tag("even")` makes it measure nothing, quietly.

interface Tag {
  name: string;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 8 + n; i++) {
    const tag: Tag = { name: "even" };
    total = total + tag.name.length;
  }
  return total;
}
