// expect: a module-scope variable of unrepresentable type (null)
// A declaration without an initializer supplies no value. Making a tagged
// global for it invented undefined: the first null-storage draft produced 27
// wrong answers instead of entering Node's catch. The control changes only
// the read to a known true value, leaving the ambient declaration in place.
declare const missing: null;

export function aMissingDeclaration(n: number): number {
  try {
    const same = missing === null;
    return same ? n : -n;
  } catch {
    return n + 1;
  }
}

export function anUnreadDeclaration(n: number): number {
  try {
    const same = true;
    return same ? n : -n;
  } catch {
    return n + 1;
  }
}
