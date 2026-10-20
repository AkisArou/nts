// Unbounded recursion ends in a RangeError ("Maximum call stack size
// exceeded"), which a program can catch: node does. nts has no stack guard,
// so on C the stack overflows into its guard page and the program dies of
// SIGSEGV instead, catch or no catch.
//
// It is also what a recursion-depth bound on a parameter would rest on
// (~/.cache/nts-scratch/compiler/queens-design.md): `placeQueen(c + 1)` keeps
// `c` a double only because nothing bounds how deep the recursion goes.
//
// The control is `bounded`: the same recursion with a base case, which
// agrees.
function down(n: number): number {
  return down(n + 1) + 1;
}
function bounded(n: number): number {
  return n >= 1000 ? n : bounded(n + 1);
}
observe("bounded", String(bounded(0)));
try {
  observe("unbounded", String(down(0)));
} catch (e) {
  observe("unbounded", e instanceof RangeError ? "RangeError" : "other");
}
done();
