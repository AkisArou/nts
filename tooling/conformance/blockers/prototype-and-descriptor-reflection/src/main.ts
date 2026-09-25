// expect: NTS1001 `Reflect.ownKeys`, which is prototype and descriptor reflection
//
// The expectation names **`Reflect`** of the four arms on purpose: it is the one
// that was wrong until this fixture existed. `Reflect` is declared as a
// *namespace* by the library, so it never reached the global-member arm the
// `Object` members go through, and it refused as "`Reflect`, a namespace" while
// the three `Object` arms beside it named the boundary. The category is now
// asked in both places, and this line is what says so.
//
// **A boundary, not a to-do list**, and until 2026-09-25 it read as the second:
// every member of this family refused as "`Object.X`, a global member with no
// definition here", which is the sentence a missing-but-buildable member gets.
// 663 refusals over 53 distinct sites in `runtime/node` and
// `runtime/web-platform` said it, and 456 of those -- 36 of the sites, one per
// Web IDL interface file -- were `Object.getOwnPropertyNames` at the head of
// this loop:
//
//     static {
//       for (const key of Object.getOwnPropertyNames(this.prototype)) {
//         const descriptor = Object.getOwnPropertyDescriptor(this.prototype, key);
//         descriptor.enumerable = true;
//         Object.defineProperty(this.prototype, key, descriptor);
//       }
//     }
//
// Implementing the member the census ranked first moves the refusal one line
// down, twice, and ends at redefining a property on a prototype object that a
// fixed layout does not have. That is why the sentence names the category: one
// reason, thirteen spellings, and a reader who acts on the ranking would have
// built `getOwnPropertyNames` and cleared nothing.
//
// # Why a fixed layout cannot answer these
//
// A value's shape is decided when it is laid out. There is no prototype object
// to hold a property, no descriptor object to describe one with, and no way to
// give a value a different shape while the program runs. Closing this is a
// representation question -- a per-object property table, which is what a
// dictionary already is and what a class deliberately is not -- rather than a
// missing function.
//
// # Controls
//
//     `Object.keys` on the same value          lowers
//     `Object.freeze`                          refuses, and NOT as reflection
//
// The first says the refusal is about the family and not about `Object`. The
// second is the load-bearing one: `freeze` is absent rather than impossible -- on
// a fixed layout it is close to the identity -- so it keeps the generic sentence,
// and a rule that swept every member of `Object` into the category would fail
// this file.

type Shape = { a: number; b: number };

/** The control that says this is not a refusal of `Object`. */
export function keysStillWork(n: number): number {
  const o: Shape = { a: n, b: n + 1 };
  return Object.keys(o).length;
}

/** The subject: a descriptor read, which no layout can answer. */
export function readsADescriptor(n: number): number {
  const o: Shape = { a: n, b: n + 1 };
  const d = Object.getOwnPropertyDescriptor(o, "a");
  return d === undefined ? -1 : 1;
}

/** The subject again, one member over: defining a property at run time. */
export function definesAProperty(n: number): number {
  const o: Shape = { a: n, b: n + 1 };
  Object.defineProperty(o, "c", { value: n });
  return o.a;
}

/** The subject through `Reflect`, which is the same question, other global. */
export function throughReflect(n: number): number {
  const o: Shape = { a: n, b: n + 1 };
  return Reflect.ownKeys(o).length;
}

/**
 * **Control.** Absent rather than impossible, so it must keep the generic
 * sentence. A rule that refused every `Object` member as reflection would give
 * this one the category's sentence and this file would stop measuring the split.
 */
export function freezeIsNotReflection(n: number): number {
  const o: Shape = { a: n, b: n + 1 };
  Object.freeze(o);
  return o.a;
}
