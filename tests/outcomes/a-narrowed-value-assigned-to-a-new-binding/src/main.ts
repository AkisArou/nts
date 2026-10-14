// **A value narrowed by `instanceof`, then assigned to a new binding, is refused
// and its statement cut, and the program answers with what the target held
// before.** Inside `if (b instanceof Leaf)` every use of `b` has static type
// `Leaf` while the value is typed `Base`. A member read carries the narrowing
// (`b.extra`), but `const alias = b` reaches `coerce` as a `Base` where a `Leaf`
// is wanted: "a pointer cast cannot widen a struct". So the assignment is
// refused, the branch is cut from the module's evaluation, and `alias.extra` is
// never read. nts answers 0, node answers 2.
//
// Two controls in the same program must keep agreeing: the same narrowed value
// read directly (`b.extra`), which has always worked, and a capture of something
// never narrowed. The subject differs from the first in one thing: the binding.
//
// **The obvious fix is unsound, and this record is here because of it.** An arm
// in `narrowed()` letting the narrowing survive the assignment, licensed by
// `descends_from`, was reverted on 2026-09-27. TypeScript is structural, so that
// licence holds with no test run: see `an-all-optional-interface-given-a-narrower-one`,
// the arm that caught it. The correct fix is a checked unerase on C and LLVM,
// with a runtime helper and a cost per unerase, so this stays open for a while.
// When it lands this reads CHANGED, and the `ran` values say whether it now
// agrees with node or has merely stopped refusing.
//
// Found by the compiler lane (28 of 87 cases differing in the examples-shaped
// form); recorded from a clean main build.

class Base {
  kind = 1;
}

class Leaf extends Base {
  extra = 2;
}

function make(): Base {
  return new Leaf();
}

const b: Base = make();

let viaNarrowedConst = 0;
if (b instanceof Leaf) {
  const alias = b;
  viaNarrowedConst = alias.extra;
}

let viaDirect = 0;
if (b instanceof Leaf) {
  viaDirect = b.extra;
}

const plain = make();
const readKind = (): number => plain.kind;
const viaPlainCapture = readKind();

observe("narrowed, assigned to a new binding, read", String(viaNarrowedConst));
observe("narrowed, read directly", String(viaDirect));
observe("a capture of something never narrowed", String(viaPlainCapture));
done();
