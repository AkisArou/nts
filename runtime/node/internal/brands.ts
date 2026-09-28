// Brands one module owns and another asks about: `util.types.isKeyObject`
// answers for `node:crypto`'s key objects without `util` importing crypto.
//
// Node answers these in C++, from the class of the native object behind the
// value, which neither a prototype nor `Symbol.hasInstance` can forge. Here
// the owning module registers the check when it loads -- a private field's
// presence, which is as unforgeable -- and before it has loaded, nothing it
// makes can exist, so the answer is false.

class Brands {
  keyObject: ((value: object) => boolean) | null = null;
}

const brands = new Brands();

/** `node:crypto`'s check, installed as its key class is defined. */
export function registerKeyObjectBrand(check: (value: object) => boolean): void {
  brands.keyObject = check;
}

/** Whether a value is one of `node:crypto`'s key objects. */
export function hasKeyObjectBrand(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const check = brands.keyObject;
  return check !== null && check(value);
}
