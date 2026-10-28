// expect: `run` is a generic method
//
// Reduced from AsyncResource#runInAsyncScope reached through EventEmitter's
// closure: the generic method has no raising entry for that closure to call.
// This is the named refusal behind StandardStream#end, distinct from L15's
// compiled wrong answer in outcomes/a-throw-from-an-optional-callback-field-escapes-a-try.
// The one-difference control is programs/a-closure-calling-a-nongeneric-throwing-method:
// remove <T> from run; every runtime operation stays the same.
// The projects are separate because the raising gate is program-wide.

class Scope {
  run<T>(n: number): number {
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
