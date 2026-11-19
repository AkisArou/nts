// run: check
// A whole program -- it exports nothing, so `nts check` runs it once on each
// side and compares its stdout and exit status -- whose recursion has no base
// case. Node ends it with an uncaught RangeError ("Maximum call stack size
// exceeded"): "before" on stdout, exit status 1. On C and LLVM the compiled
// program is killed by SIGSEGV after "before", which the check reports as an
// abort, never as a status: native stack exhaustion should raise a catchable
// RangeError (#885). The JVM's StackOverflowError ends it with status 1, as
// node does, and agrees.
//
// The control is tests/programs/a-whole-program-prints-its-lines, the same
// route with nothing to exhaust, which agrees on every backend.
function down(n: number): number {
  return down(n + 1) + 1;
}
console.log("before");
console.log(down(0));
