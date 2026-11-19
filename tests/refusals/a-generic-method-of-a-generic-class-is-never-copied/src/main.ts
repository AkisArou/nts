// expect: `run` is a generic method inside a generic class or function, whose instances are not copied per instance of what encloses it
//
// A closure calling a throwing generic method of a generic class, inside a
// `try`. #843 copies a generic method per instance only where nothing
// encloses it with type parameters of its own, so `Scope<U>#run<T>` has no
// raising copy, and the program's closure raising gate stays off. #843's
// design keyed a method's instances by the receiver's class instance as well;
// that part is deferred to #865.
// The one-difference control is programs/a-closure-calling-a-generic-throwing-method:
// remove <U> from Scope; every runtime operation stays the same.

class Scope<U> {
  run<T>(n: number): number {
    if (n < 0) throw new RangeError("scope");
    return n + 1;
  }
}

export function result(n: number): number {
  const scope = new Scope<string>();
  const callback = (): number => scope.run(n);
  try {
    return callback();
  } catch {
    return -1;
  }
}
