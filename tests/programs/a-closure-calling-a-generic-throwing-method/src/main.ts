// A closure calling a throwing generic method, inside a `try`: a guard since #843.
//
// Reduced from AsyncResource#runInAsyncScope reached through EventEmitter's
// closure. Until #843 the generic method had no raising entry for that closure
// to call, and this was the named refusal behind StandardStream#end (a
// blocker expecting "`run` is a generic method"); a class's generic method now
// has a copy per instance with its raising form, so the `throw` reaches the
// handler. Distinct from L15's compiled wrong answer in
// outcomes/a-throw-from-an-optional-callback-field-escapes-a-try.
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
