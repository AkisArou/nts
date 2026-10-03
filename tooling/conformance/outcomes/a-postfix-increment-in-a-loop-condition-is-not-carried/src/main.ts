// A postfix increment in a loop's condition is not carried round the loop.
//
// `while (count++ < 9) fraction *= 10` compiles to a loop header whose block
// parameters carry `fraction` and not `count`: `count + 1` is computed and
// dropped, so the condition tests the value `count` had on entry forever. With
// nothing else bounding it the loop never ends -- the Builtins lane traced a
// Temporal.Duration parse hang to exactly this (`parseDuration`'s fraction
// padding) and wrote the padding another way. Every backend agrees, because
// the lost update is in the lowered HIR: c, llvm and jvm all hang on the bare
// shape.
//
// The witness is bounded so it answers rather than hangs (an outcomes run
// that times out is recorded as not measured): a second counter the loop
// *does* carry stops it after 20 steps, so the defect reads as 20 steps where
// node takes 9 - count. Both a `for` and a `while` condition show it.
//
// **Control:** the same loop with the increment in the body, which is carried
// and agrees.
//
// **Expected, confirmed under node:** from 3, 6 steps in every arm; the final
// count is 10 for the two condition arms -- `count++ < 9` is false at 9 and
// still increments -- and 9 for the control (610, 610, 609). nts answers 2003
// for both condition arms: 20 steps, `count` still 3.
function bounded(start: number): number {
  let count = start;
  let steps = 0;
  for (let i = 0; i < 20 && count++ < 9; i++) steps++;
  return steps * 100 + count;
}

function inWhile(start: number): number {
  let count = start;
  let steps = 0;
  let i = 0;
  while (i < 20 && count++ < 9) {
    steps++;
    i = i + 1;
  }
  return steps * 100 + count;
}

function inBody(start: number): number {
  let count = start;
  let steps = 0;
  while (count < 9) {
    count++;
    steps++;
  }
  return steps * 100 + count;
}

observe("a postfix increment in a for condition", String(bounded(3)));
observe("a postfix increment in a while condition", String(inWhile(3)));
observe("the increment in the body (control)", String(inBody(3)));
done();
