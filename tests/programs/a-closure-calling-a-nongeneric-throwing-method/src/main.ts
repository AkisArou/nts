// Control for refusals/a-closure-calling-a-generic-throwing-method.
// The only body difference is removal of run's <T> declaration; the callback,
// its thrown RangeError and the enclosing catch are unchanged. Both pins
// agree with node on C, LLVM and JVM, including the negative inputs that throw.

class Scope {
  run(n: number): number {
    if (n < 0) throw new RangeError("scope");
    return n + 1;
  }
}

export function result(n: number): number {
  const scope = new Scope();
  const callback = (): number => scope.run(n);
  try {
    return callback();
  } catch {
    return -1;
  }
}
