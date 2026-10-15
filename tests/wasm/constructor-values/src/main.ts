// A class constructor passed as a value of a constructor type and compared by
// identity, as test262's `assert.throws(TypeError, fn)` passes one. `Error`'s
// constructor is then a signature, held as the callable root itself, and
// `TypeError`'s extends it: its storage must carry the root's entries to be a
// subtype, though nothing calls them. The control passes a class of the
// program's own, whose constructor value extends no callable.

class Plain {
  constructor(public message: string) {}
}

function isInstance(thrown: unknown, expected: new (message: string) => unknown): boolean {
  if (expected === TypeError) return thrown instanceof TypeError;
  if (expected === RangeError) return thrown instanceof RangeError;
  if (expected === Error) return thrown instanceof Error;
  return false;
}

function throws(expected: new (message: string) => unknown, fn: () => void): string {
  try {
    fn();
    return "nothing";
  } catch (thrown) {
    return isInstance(thrown, expected) ? "matched" : "another";
  }
}

function raise(n: number): void {
  if (n > 0) throw new TypeError("t");
  if (n < 0) throw new RangeError("r");
}

export function typeErrors(n: number): string {
  return throws(TypeError, () => raise(n));
}

export function rangeErrors(n: number): string {
  return throws(RangeError, () => raise(n));
}

export function anyError(n: number): string {
  return throws(Error, () => raise(n));
}

function isPlain(made: unknown, expected: new (message: string) => unknown): boolean {
  return expected === Plain && made instanceof Plain;
}

export function control(n: number): string {
  return isPlain(new Plain(String(n)), Plain) ? "plain" : "other";
}
