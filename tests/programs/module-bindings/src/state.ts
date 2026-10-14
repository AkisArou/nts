// A module-scope `let` that another module reads. It is a *global* in the
// emitted program -- one cell, written by whichever module writes it, read by
// whichever module reads it -- and reading it from `main` is what an import of
// a value means.
export let count = 10;

// A `const` with a constant initializer is a value rather than storage: the
// reader gets the number, and nothing is allocated.
export const base = 5;

export function bump(): void {
  count += 1;
}

export function seen(): number {
  return count;
}
