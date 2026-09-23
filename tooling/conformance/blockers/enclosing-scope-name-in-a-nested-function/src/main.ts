// expect: a name from an enclosing scope
//
// What is **left** of this row after 2026-09-24: a nested function that reads a
// local of its enclosing function **and reads its own `this`**.
//
// It said *binds* until 2026-09-24, and the subject below said it with a
// `this: unknown` parameter its body never touched -- so the fixture tested an
// annotation. A `this` parameter is erased before any backend sees it, and
// `binds_this` now decides on the body, which cleared 78 occurrences across ten
// modules from one construct in `events`. The subject now reads `this.offset`,
// and `annotatedButUnread` beside it is the control that says which of the two
// the refusal is about.
//
// # The row closed for everything else
//
// A nested `function` declaration is a hoisted `const` holding a function
// expression, and the desugaring landed:
// `examples/a-nested-function-that-captures` runs 145 cases across five
// functions on C, LLVM and the JVM, including a recursive one. The corpus:
//
//     util   5 -> 1     net   21 -> 1     assert 4 -> 0
//     stream 21 -> 0    http  24 -> 1
//
// Every remaining site in the corpus is the shape below: `util`'s one is
// `promisified`, declared `function promisified(this: unknown, ...args)`.
//
// # Why `this` keeps it out
//
// A closure has no `this` of its own — it inherits the enclosing one, which is
// what an arrow does and what a `function` deliberately does not. The
// collector's test is the same one the `function` *expression* arm has always
// used, so this is not a new restriction: it is the existing line, now reached
// by a second form.
//
// Closing it means giving a closure a receiver distinct from its environment,
// which is a representation question rather than a desugaring one.
//
// # And use before the declaration, which is a different limit
//
//     function outer(n) {
//       const base = n & 7;
//       const first = later(2);          // hoisted in JavaScript
//       function later(k) { return base + k }
//     }
//
// A declaration is usable above its textual position and a `const` is not. The
// binding is made where the declaration stands, so a call above it resolves to
// a function that is no longer emitted and refuses as a cascade.
//
// **Hoisting the allocation would not fix it**, and that is the interesting
// part: this captures *by value*, so an allocation moved to the top of the
// block would read locals that do not have their values yet. The limit is
// capture-by-value, not the desugaring, and the honest fix is a cell — the same
// machinery `a closure over a `for` loop's own variable` needed for the case it
// still refuses.
//
// # Three controls
//
//     the same function without `this`     lowers, and agrees with node
//     nested, capturing nothing            lowers, and always did
//     module scope                         a plain function, never a closure
//
// All three are in the example. The first is the one that matters: it differs
// from the subject below in nothing but the receiver.

export function control(columns: number, index: number): number {
  return index * columns;
}

/**
 * Under test: captures, and **reads** its own `this`.
 *
 * This used to be `function visit(this: unknown, index: number)` whose body
 * never mentioned `this` -- so it tested the *annotation* rather than the
 * receiver, and it lowered the moment `binds_this` started deciding on the
 * body. A `this` parameter is erased before any backend sees it; only a body
 * that reads one needs a receiver, which is the representation question this
 * row is actually about. `examples/a-this-parameter-the-body-never-reads`
 * carries the half that landed.
 */
export function subject(columns: number): number {
  function visit(this: { offset: number }, index: number): number {
    return index * columns + this.offset;
  }
  return visit.call({ offset: 1 }, 2);
}

/**
 * The control that separates the two: the same capture, `this` annotated and
 * never read. It lowers, and if it ever stops, the subject above is refusing
 * for the annotation rather than for the receiver.
 */
export function annotatedButUnread(columns: number): number {
  // Named `inspect` rather than `visit` for the reason the header gives about
  // `withoutThis`: two nested functions of one name in one file is `a second
  // function named `visit``, a different row that would be reported as this
  // one. The comment three lines above the subject says so, and I did it
  // anyway on the first attempt.
  function inspect(this: unknown, index: number): number {
    return index * columns;
  }
  return inspect.call(undefined, 2);
}

/**
 * The control that landed: the same body without a `this`.
 *
 * Named differently from the subject on purpose — two nested functions of one
 * name in one file is `a second function named \`visit\``, which is a
 * different row and would have been reported as this one.
 */
export function withoutThis(columns: number): number {
  function walk(index: number): number {
    return index * columns;
  }
  return walk(2);
}
