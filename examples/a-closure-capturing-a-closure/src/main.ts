// One closure capturing another, which is how JavaScript writes a helper beside
// the thing that uses it.
//
// A closure's captures are typed **twice**: the enclosing function stores the
// value and takes the value's own type, and the body reads the field back and
// took the *checker's* type of the name. For a captured number those agree. For
// a captured arrow they do not — the checker's type of an arrow is its function
// type, which has no layout — so the emitted HIR was
//
//     field.set %2.0 = %1            managed<closure#0>    the store
//     %1 = field.get %0.0            managed<obj#4>        the read
//
// and the C backend refused with `an object type with no layout: type 4`. The
// two sides build `Field` lists that `collect_layouts` merges, and the comment
// there calls that merge "the check that the two sides agree" — it merged them
// without noticing, because the field's name and index agreed and only its type
// did not.
//
// The read now asks the same question the store answers: a name bound to a
// `const` arrow has that closure's layout. `const` is the whole soundness
// argument and it is `closure_typed_global`'s, word for word — a slot typed by a
// closure holds exactly the closure it was typed by.
//
// **A reassignable one is refused by name**, at the bottom of this file's story:
// two arrows are two layouts, and there is no single field type for the slot.

/** The plain shape: an inner helper, an outer closure that calls it. */
export function chained(n: number): number {
  const inner = (k: number): number => k + 1;
  const outer = (): number => inner(n);
  return outer();
}

/** Three deep, so a fix that only handled one level would show. */
export function twoDeep(n: number): number {
  const double = (k: number): number => k * 2;
  const bump = (k: number): number => double(k) + 1;
  const run = (): number => bump(n);
  return run();
}

/** Capturing a closure *and* a number, so the field order has to survive both. */
export function capturesBoth(n: number): number {
  const add = (k: number): number => k + n;
  const use = (k: number): number => add(k) + n;
  return use(3);
}

/** The captured closure captures too, so the inner object is not empty — an
 *  empty one would be the same pointer whatever the layout said. */
export function bothCapture(n: number): number {
  const scale = (k: number): number => k * n;
  const twice = (k: number): number => scale(scale(k));
  return twice(n & 3);
}

/** Written with an annotation rather than inferred, which is a different node
 *  shape reaching the same binding. */
export function annotated(n: number): number {
  const inner: (k: number) => number = (k) => k + 5;
  const outer = (): number => inner(n);
  return outer();
}

/** Two closures capturing the *same* one, so a layout claimed by the first
 *  capture has to serve the second. */
export function shared(n: number): number {
  const base = (k: number): number => k + 1;
  const left = (): number => base(n);
  const right = (): number => base(n * 2);
  return left() + right();
}
