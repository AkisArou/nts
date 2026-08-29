// A module-scope `const` whose value is computed rather than written down.
//
// This is the most ordinary line in a module and it did not compile: a global's
// initial value has to be a number the artifact can carry, and `scale(3)` is
// not one, so the whole declaration was refused. It is a global initialised to
// zero and assigned by `module#init`, in evaluation order with everything else.
export function scale(n: number): number {
  return n * 7;
}

export const base = scale(3);

// Reads the one above it, so source order within a module is observable rather
// than merely plausible.
export const doubled = base * 2;

let counter = 0;

export function bump(): number {
  counter = counter + 1;
  return counter;
}

// Evaluated once, at module evaluation time -- not once per read. If this were
// re-run on each access the two readers below would disagree with node.
export const once = bump();
