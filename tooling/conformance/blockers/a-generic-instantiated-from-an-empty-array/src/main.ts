// expect: NTS1001 a property `a` of unrepresentable type (a union of an array | undefined)
//
// **The expectation moved on 2026-09-22, and it moved toward the cause.** It
// was `a member of `Box`, a class this compiler has no type for` -- the
// message a generic class gives when it has no instantiation to lower, which
// this one had because `never[]` has no representation. The frontend
// decomposes a program's own generic forms now (`hir::instantiate` needs
// their members), so `Box<never[]>` is refused at the property whose type
// has no width, in the words the plain-class control below always used.
// Same program, same cause, the message one layer in.
//
// **99 refusal sites in `runtime/node`**, the second-largest cause once the
// census is measured by site, and it is none of the three things it looks like.
//
// The message names a class, and the classes it names are `PipeState<T>`,
// `ByteTeeState<T>`, `TeeState<T>`, `Immediate<Args>` -- all generic, all in
// large subsystems. It reads as "generic classes do not lower" or as a
// web-streams cascade. Varying one thing at a time says neither:
//
// ```text
// class Box<T> ... new Box<number>(3)            lowers
// class Box<T = number> ... new Box(3)           lowers
// class Box<A extends unknown[] = []> ...        lowers
// class Box implements H ... generic             lowers
// two instantiations at different arguments      lowers
// declared in one file, instantiated in another  lowers
//
// class Box<A extends unknown[] = []> ... new Box([])   REFUSED
// ```
//
// The last line differs from the one above it **only in the argument**:
// `new Box<[number]>([1])` lowers and `new Box([])` does not. An empty array
// literal infers `A = never[]`, `nts types` confirms it with a bare `#17 Never`
// in the table, and the whole cause is that **`never[]` has no
// representation**.
//
// It is not about generics at all. A plain class says it more directly:
//
//     class B { a: never[] | undefined }
//     NTS1001 a property `a` of unrepresentable type (a union of an array | undefined)
//
// # Why it is refused, and why the obvious fix is unsafe
//
// `representation_within` ends with a filter that rejects an array whose
// element is `NativePointer`, `Void` or `Never`. The comment beside it explains
// `Void` -- `NTS_ITEMS(v, void)[i]` is not C, and that shape "exited 0 and
// `cc` failed on generated code" -- and says nothing about `Never`.
//
// The obvious fix is to give a `never` element some width, since no value of
// type `never` exists and no element can ever be read. That is unsound, and the
// reason is **aliasing**:
//
//     const n: never[] = [];
//     const s: string[] = n;      // TypeScript allows this
//     s.push("a");                // node prints `1 a`
//
// Verified against node, which runs it, and against this checker, which raises
// no `TS` error on the assignment. So a `never[]` given a number element would
// carry a number descriptor into a `string[]` slot, and the push would store a
// pointer through it. An empty array is not a safe array to guess the element
// of, precisely because it can be widened to any other.
//
// What would close it is a representation that survives that widening -- an
// erased element, or a descriptor chosen at the assignment rather than at the
// literal -- which is the same question `array_literal_type` already records
// one container over: a literal's own type wins over the slot's and should not.
//
// # A message that contradicts itself, one level down
//
// The aliasing program refuses with
//
//     a module-scope variable of unrepresentable type (an array of a
//     representable type)
//
// which says the array is unrepresentable *because* its element is
// representable. `never` describes as "a value that cannot exist" elsewhere in
// the same file, so the describer and the filter disagree about it. Worth a
// line of its own when this is picked up.

class Box<A extends unknown[] = []> {
  a: A | undefined;
  n: number;

  constructor(a: A) {
    this.a = a;
    this.n = 1;
  }

  get(): number {
    return this.n;
  }
}

const box = new Box([]);

export function held(): number {
  return box.get();
}
