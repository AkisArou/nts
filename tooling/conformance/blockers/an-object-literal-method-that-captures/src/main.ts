// expect: NTS1001 `base`, a name from an enclosing scope

// A **method shorthand** on an object literal that closes over a local.
//
//     const adapter = { read(): number { return base + 1; } };
//
// The two other spellings of the same thing both work:
//
//     { read: (): number => base + 1 }              an arrow property
//     { read: function (): number { … } }           a function-expression property
//
// So this is not "closures in object literals"; it is one syntax of three, and
// the one a program reaches for when it is writing an adapter.
//
// # Demand, measured 2026-09-18
//
// **33 distinct sites** in the profile, and they are one idiom: an object
// literal standing in for an interface, whose methods read the locals of the
// function that built it.
//
//     web-platform/src/streams/readable.ts:3174   pull(controller) { … position … }
//     web-platform/src/http1/transport.ts:191     read(maxBytes) { return reader.some(maxBytes) }
//     web-platform/src/cache/store.ts:115         pull(controller) { … chunks[index++] … }
//
// That makes it the largest cluster of `a name from an enclosing scope` and the
// fourteenth item overall by distinct site.
//
// # Why it is not a small fix, which is the point of this file
//
// `f(x): number` is a method the dispatch table holds and `f: (x) => number` is
// storage — the ledger row for a function held in a field says so, and the
// checker is what says which. A method has no environment; a closure carries
// one. So a capturing method has to become storage.
//
// **And storage is a property of the *type*, while capture is a property of the
// *literal*.** `layout_of` builds one layout per type id, every literal of that
// type shares it, and two literals of one type may differ in whether their
// methods capture:
//
//     function make(seed: number) {
//       const a: Reader = { read() { return seed; } };   // captures
//       const b: Reader = { read() { return 0; } };      // does not
//       return [a, b];
//     }
//
// Both are `Reader`. One layout. So the decision cannot be made at the literal:
// it is "does **any** literal of this type have a capturing method", which is a
// whole-program question of the kind the compiler already answers for class
// tokens and for the hierarchy — `decompose.rs` already registers every
// anonymous object type carrying a member, which is where the set would come
// from.
//
// The three routes, so whoever takes it starts from the analysis:
//
//   every object-literal method becomes storage
//     — uniform, no whole-program pass, and it changes the representation of a
//       shape that works today and was deliberately chosen; the ledger row
//       defends the dispatch table and `examples/a-method-on-an-object-literal`
//       guards it
//   per type, by a pass over all literals of that type
//     — correct and confined, and the pass is the work: a type whose methods
//       are storage in one function and a table in another is the bug this
//       avoids, so the answer has to be computed before any layout is built
//   an environment pointer on the object, filled per literal
//     — keeps the table, adds one field to every literal of a type that needs
//       it, and needs the same whole-program question answered first, so it is
//       the second route plus a representation choice rather than an
//       alternative to it
//
// A `FIXED` here means one of the three was built. A `CHANGED` means the
// refusal moved, which is worth reading: the message names the captured name,
// so a different name means a different shape reached it.

interface Reader {
  read(): number;
}

export function adapter(n: number): number {
  const base = n * 2;
  const reader: Reader = {
    read(): number {
      return base + 1;
    },
  };
  return reader.read();
}
