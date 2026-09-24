// expect: `once`, captured above its own declaration, where it has no value yet
//
// **A closure that refers to its own binding.** The JavaScript idiom for a
// listener that removes itself, and the largest single root left in the node
// corpus after the `this`-annotation fix:
//
//     107 occurrences   43 NTS1001 roots, 64 cascades
//       5 sites         events x2, process, stream, util
//
// `EventEmitter#once` and `#prependOnceListener` are behind it, and through
// them `Readable#once`, `Socket#_read`, `Socket#_final` and four `Utf8Stream`
// methods. `events`' own spelling:
//
//     const wrapper: Listener = function (this: unknown, ...args) {
//       ...
//       target.removeListener(type, wrapper);   // <- itself
//     };
//
// # The condition is one line, and it is not the hard part
//
// `collect_closures` already marks a capture **by reference** -- a cell -- when
// the captured name's declaration sits *after* the closure, because the binding
// has no value when the closure is built. Its own comment gives the case:
//
//     const onListening = () => { ...cleanup...; };
//     const cleanup = ...;
//
// A closure's own name is the same situation and the test misses it, because
// the declaration is not *below* the arrow but *around* it. Both are one
// condition -- **the declaration ends after the arrow does**. A declaration
// that follows the arrow ends after it; one that encloses it ends after it; an
// ordinary prior `const base = n * 2` ends before the arrow starts. So
//
//     declared.span.start > arrow.span.start
//   becomes
//     declared.span.end   >= arrow.span.end
//
// # What stands behind it, measured rather than guessed
//
// **That change alone makes this worse, and it was tried.** All four arms below
// stop refusing and start *declining*:
//
//     NTS2006 an object type with no layout: type 5
//
// which is the outcome this project ranks below a refusal. `nts types` names
// type 5: ``__function` Function(SignatureId(6))` -- the **checker's signature
// type** for the arrow. A closure's layout hangs on the synthetic closure class
// (`SYNTHETIC_CLOSURES + index`), not on that, so `captured_as` hands
// `cell_layout` a type nothing has built a layout for.
//
// So the remaining work is in `captured_as`: a capture whose symbol denotes a
// closure *this program builds* must be held at the synthetic closure class.
// That is a representation change, and its failure mode is a **wrong layout**
// rather than a refusal -- C and LLVM would agree by luck and the JVM would
// catch it, which is the split `the JVM lane is the type-confusion oracle`
// names. It wants a session that can run the three-backend agreement, not a
// one-line condition.
//
// The experiment is recorded here rather than committed: the condition is
// right and incomplete, and a reader who tries it will get NTS2006 and think
// the idea is wrong.
//
// # Why a cell rather than storing the closure into its own field
//
// `lower_arrow` returns the environment object, so it is tempting to write the
// object into its own capture slot and skip the cell. That works for a `const`
// and not for the general case -- `let f = ...; f = other;` must be seen by the
// body -- and the cell machinery already exists on all three backends, which is
// what `blockers/enclosing-scope-name-in-a-nested-function` meant by "the
// honest fix is a cell".

/** Under test: an arrow that names itself. */
export function once(n: number): number {
  let calls = 0;
  const once = (k: number): number => {
    calls += 1;
    return calls === 1 ? once(k + 1) : k;
  };
  return once(n);
}

/** Under test: the same as a `function` expression rather than an arrow. */
export function asExpression(n: number): number {
  let calls = 0;
  const step = function (k: number): number {
    calls += 1;
    return calls === 1 ? step(k + 1) : k;
  };
  return step(n);
}

/**
 * Control: a nested function **declaration** that recurses, which lowers.
 *
 * A declaration is hoisted, so its binding exists before the body is built --
 * which is why the same recursion is fine in this form and says the subject is
 * about the binding's timing rather than about recursion.
 */
export function declaredRecursion(n: number): number {
  function step(k: number): number {
    return k <= 0 ? 0 : k + step(k - 1);
  }
  return step(n);
}

/**
 * Control: a closure capturing a different `const` declared above it.
 *
 * This is the arm that fails if the condition is widened too far: an ordinary
 * prior declaration ends before the arrow starts, and must stay a by-value
 * capture rather than becoming a cell.
 */
export function capturesAnother(n: number): number {
  const base = n * 2;
  const f = (k: number): number => base + k;
  return f(1);
}
