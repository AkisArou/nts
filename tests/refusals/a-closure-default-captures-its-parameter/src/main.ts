// expect: emit-c -> NTS2006 a field operation on something that is not an object
// A default closure captures the parameter that the function subsequently
// writes. The control changes only the closure's body from x to a constant.
// Both are ordinary functions: the capture gap precedes generator suspension.
// The refusal reproduces on genuine main's 64fe6c9fc pin and on 7a46359bda5e.
// Replacing the one captured x with 1 gives 58/58 differential agreements;
// the captured and noncapturing closures must receive different evidence.

function captured(x: number, read = () => x): number {
  x = 2;
  return read();
}

function constant(x: number, read = () => 1): number {
  x = 2;
  return read();
}

export function subject(n: number): number {
  return captured(n | 0);
}

export function control(n: number): number {
  return constant(n | 0);
}
