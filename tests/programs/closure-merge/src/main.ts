// Two arrows reaching one variable, and the call that follows.
//
// `let f = A; if (c) { f = B }; f(x)` is ordinary TypeScript and it answered
// the wrong number. Two arrows are two closure *classes* -- siblings, with no
// relation between them -- and the merge at the end of the `if` was typed as
// whichever arm came first. Every pass after that believed it: the call was
// devirtualised to that arm's body, reachability then found nothing calling
// the other, and the other body was **deleted**. So the program did not call
// the wrong closure by accident; there was only one left to call.
//
// It was invisible on the two pointer backends, which is the point of having a
// third: an upcast is a pointer here and a checked store on the JVM, and the
// JVM refused to emit it. `nts check` on this file answered 15 where node
// answers 8, on C and on LLVM, with no diagnostic anywhere.
//
// The merge takes the binding's *declared* type now -- the signature both
// closures are related to -- so the call is a dispatch through the slot, which
// is what "call this closure, whichever it is" means.

type Mapper = (value: number) => number;

export function twoClosures(k: number, pick: boolean): number {
  let f: Mapper = (v) => v + k;
  if (pick) {
    f = (v) => v * k;
  }
  return f(5);
}

// The same shape written as a conditional expression, which lowers through a
// different path to the same merge.
export function ternary(k: number, pick: boolean): number {
  const f: Mapper = pick ? (v) => v * k : (v) => v + k;
  return f(5);
}

// Three arms, so the merge is not a special case of two. The `else if` nests a
// second merge inside the first, and the outer one sees a value that is itself
// a block parameter.
export function threeWays(k: number, which: number): number {
  let f: Mapper = (v) => v + k;
  if (which > 0) {
    f = (v) => v * k;
  } else if (which < 0) {
    f = (v) => v - k;
  }
  return f(10);
}

// Different captures, which is what makes the deleted-body case dangerous
// rather than merely wrong. Both closures above capture one `number` at the
// same offset, so reading the wrong class's field still read a number. These
// two capture different shapes.
export function differentCaptures(k: number, pick: boolean): number {
  const label = "ab";
  let f: Mapper = (v) => v + label.length;
  if (pick) {
    f = (v) => v * k;
  }
  return f(3);
}

// A merge inside a loop body. The binding is fresh each iteration, so nothing
// is carried around the back edge -- what this adds is a merge reached more
// than once, which is where a block parameter typed from one arm would be
// re-observed rather than merely written.
export function inALoop(k: number, limit: number): number {
  const bound = limit > 5 ? 5 : limit | 0;
  let total = 0;
  for (let at = 0; at < bound; at = at + 1) {
    const even = at % 2 === 0;
    let f: Mapper = (v) => v + k;
    if (even) {
      f = (v) => v * k;
    }
    total = total + f(2);
  }
  return total;
}

// And the control: one arrow, no merge. It must keep being devirtualised --
// the fix is about a merge of *different* closures, and making every closure
// call an indirect one would be a real cost paid for nothing.
export function single(k: number): number {
  const f: Mapper = (v) => v + k;
  return f(7);
}
