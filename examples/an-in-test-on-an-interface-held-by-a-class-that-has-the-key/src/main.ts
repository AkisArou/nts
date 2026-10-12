// `"tag" in f` where `f: F` and `F` does not declare `tag`, held by a class
// that has it. An interface holds any object of its shape, so the answer is the
// object's own: node says true for a `Tagged` and false for a `Plain`. Main
// folded it to `false` from `F`'s members alone, 20 of 29 cases wrong on C,
// LLVM and the JVM; Part 2 stage B tests every object type at run time.
// Found by the JVM lane reviewing stage B.
interface F { a: number }
class Tagged { tag = "t"; a = 7 }
class Plain { a = 8 }
function readIn(f: F): number {
  let seen = 0;
  if ("tag" in f) seen = 1;
  return f.a + seen * 100;
}
export function inIfaceClass(n: number): number { return n > 0 ? readIn(new Tagged()) : readIn(new Plain()); }
